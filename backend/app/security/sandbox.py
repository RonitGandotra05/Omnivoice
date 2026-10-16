"""Production Linux parser sandbox. The runtime must permit unprivileged namespaces."""
import shutil
import sys
from pathlib import Path
from fastapi import HTTPException


def command(extension, required=False):
    if not required:
        return [sys.executable, '-m', 'app.utils.parse_worker', extension]
    if not sys.platform.startswith('linux') or not shutil.which('bwrap'):
        raise HTTPException(503, 'The isolated document sandbox is unavailable.')
    # No host root, .env, home, DB files, sockets or cloud credentials are mounted.
    args = [shutil.which('bwrap'), '--unshare-all', '--die-with-parent', '--new-session', '--cap-drop', 'ALL']
    for path in ('/usr', '/bin', '/lib', '/lib64'):
        if Path(path).exists():
            args += ['--ro-bind', path, path]
    for path in ('/etc/fonts', '/etc/ld.so.cache'):
        if Path(path).exists():
            args += ['--ro-bind', path, path]
    source = Path(__file__).resolve().parents[1]
    args += ['--dir', '/app', '--ro-bind', str(source), '/app/app', '--proc', '/proc', '--dev', '/dev',
             '--tmpfs', '/tmp', '--chdir', '/app', '--setenv', 'HOME', '/tmp', '--setenv', 'TMPDIR', '/tmp',
             '--', '/usr/local/bin/python', '-m', 'app.utils.parse_worker', extension]
    return args
