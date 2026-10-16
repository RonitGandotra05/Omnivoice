"""Bound concurrent parsers and kill the whole OCR process group on timeout."""
import asyncio
import json
import os
import signal
import sys
from fastapi import HTTPException
from app.config.settings import get_settings

_slots = None
_slot_limit = None


async def parse_isolated(raw, extension):
    global _slots, _slot_limit
    settings = get_settings()
    from app.security.malware import scan
    await scan(raw)
    from app.security.sandbox import command
    arguments = command(extension, settings.production_mode or settings.parser_sandbox_required)
    if _slots is None or _slot_limit != settings.parser_concurrency:
        _slot_limit = settings.parser_concurrency
        _slots = asyncio.Semaphore(max(1, _slot_limit))
    try:
        await asyncio.wait_for(_slots.acquire(), timeout=1)
    except TimeoutError:
        raise HTTPException(429, 'Document processors are busy. Please retry.', headers={'Retry-After': '3'})
    process = None
    try:
        allowed = ('PATH', 'LANG', 'LC_ALL', 'TESSDATA_PREFIX', 'SYSTEMROOT', 'TMPDIR', 'TMP', 'TEMP')
        environment = {key: os.environ[key] for key in allowed if key in os.environ}
        for key in ('ocr_enabled', 'ocr_review_required', 'ocr_languages', 'ocr_dpi', 'ocr_min_confidence', 'pdf_max_pages', 'pdf_max_ocr_pages', 'pdf_max_render_pixels', 'max_document_characters'):
            environment[key.upper()] = str(getattr(settings, key))
        # Settings must not load backend/.env inside the untrusted parser process.
        environment['PARSER_ISOLATED'] = '1'
        environment['OMP_THREAD_LIMIT'] = '1'
        process = await asyncio.create_subprocess_exec(*arguments,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            env=environment, start_new_session=True)
        try:
            stdout, _ = await asyncio.wait_for(process.communicate(raw), settings.parser_timeout_seconds)
        except TimeoutError:
            raise HTTPException(422, 'Document processing timed out. Split the document into smaller files or provide a clearer scan.')
        if process.returncode or len(stdout) > 2 * 1024 * 1024:
            raise HTTPException(422, 'Document processing exceeded resource limits or failed.')
        data = json.loads(stdout)
        if not data.get('ok'):
            raise HTTPException(422, data.get('error', 'Unable to read this document.'))
        return data['result']
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(503, 'Document processing is temporarily unavailable.') from exc
    finally:
        if process and process.returncode is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            await process.wait()
        _slots.release()
