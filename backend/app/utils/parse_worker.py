"""Isolated parser subprocess entry point. No provider credentials are inherited."""
import json
import sys
import resource
from app.utils.document_parser import parse_buffer


def main():
    if sys.platform.startswith('linux'):
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (120, 120))
    resource.setrlimit(resource.RLIMIT_FSIZE, (64 * 1024 * 1024, 64 * 1024 * 1024))
    try:
        payload = sys.stdin.buffer.read(10 * 1024 * 1024 + 1)
        if len(payload) > 10 * 1024 * 1024:
            raise ValueError('Maximum file size is 10 MB.')
        result = parse_buffer(payload, sys.argv[1], 'uploaded-document')
        sys.stdout.write(json.dumps({'ok': True, 'result': result}))
    except Exception as exc:
        safe = str(exc) if isinstance(exc, ValueError) else 'Document parsing failed. The document may be corrupt, encrypted, or unsupported.'
        sys.stdout.write(json.dumps({'ok': False, 'error': safe[:300]}))


if __name__ == '__main__':
    main()
