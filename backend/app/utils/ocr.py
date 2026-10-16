"""Local Tesseract OCR. Confidence is a review signal, never an accuracy guarantee."""
import csv
import io
import re
import shutil
import subprocess
import tempfile
from pathlib import Path


def availability(languages='eng'):
    executable = shutil.which('tesseract')
    if not executable:
        return False
    try:
        result = subprocess.run([executable, '--list-langs'], capture_output=True, text=True, errors='replace', timeout=5)
        installed = set(result.stdout.splitlines()[1:])
        return result.returncode == 0 and (set(languages.split('+')) | {'osd'}).issubset(installed)
    except (OSError, subprocess.TimeoutExpired):
        return False


def recognize(image, *, languages='eng', timeout=25):
    executable = shutil.which('tesseract')
    if not executable or not re.fullmatch(r'[a-zA-Z0-9_]+(?:\+[a-zA-Z0-9_]+)*', languages):
        raise ValueError('OCR is unavailable. Install Tesseract and the configured language packs.')
    with tempfile.TemporaryDirectory(prefix='omnivoice-ocr-') as directory:
        path = Path(directory).resolve() / 'page.png'
        image.save(path, dpi=(300, 300))
        # OSD uses only the page pixels and never sends content outside this host.
        rotation = 0
        try:
            orientation = subprocess.run([executable, str(path), 'stdout', '--psm', '0'], capture_output=True, text=True, errors='replace', timeout=10)
            match = re.search(r'Rotate:\s*(90|180|270)', orientation.stdout)
            if match:
                rotation = int(match.group(1))
                image = image.rotate(-rotation, expand=True)
                image.save(path, dpi=(300, 300))
        except subprocess.TimeoutExpired:
            pass
        result = subprocess.run([executable, str(path), 'stdout', '-l', languages, '--oem', '1', '--psm', '3', 'tsv'],
            capture_output=True, text=True, errors='replace', timeout=timeout)
        if result.returncode:
            raise ValueError('OCR could not read this page. Check the language packs or provide a clearer scan.')
        lines = {}
        weighted, total = 0.0, 0
        for row in csv.DictReader(io.StringIO(result.stdout), delimiter='\t'):
            text = (row.get('text') or '').strip()
            try:
                confidence = float(row.get('conf', '-1'))
            except ValueError:
                continue
            if not text or confidence < 0:
                continue
            key = (row.get('block_num'), row.get('par_num'), row.get('line_num'))
            lines.setdefault(key, []).append(text)
            weight = len(text)
            weighted += confidence * weight
            total += weight
        content = '\n'.join(' '.join(words) for words in lines.values())
        return {'text': content, 'confidence': round(weighted / total, 1) if total else 0, 'rotation': rotation}
