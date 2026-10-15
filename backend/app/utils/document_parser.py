"""
Document Parser – parses PDF, TXT, MD, JSON, DOCX into plain text.
"""

import json
from pathlib import Path
from io import BytesIO

# Optional imports (graceful degradation)
try:
    from pypdf import PdfReader
    _HAS_PDF = True
except ImportError:
    _HAS_PDF = False

try:
    import docx
    _HAS_DOCX = True
except ImportError:
    _HAS_DOCX = False


SUPPORTED_EXTENSIONS = {"txt", "md", "json"}
if _HAS_PDF:
    SUPPORTED_EXTENSIONS.add("pdf")
if _HAS_DOCX:
    SUPPORTED_EXTENSIONS.add("docx")


def get_supported_types() -> set[str]:
    return SUPPORTED_EXTENSIONS


# ── Public API ────────────────────────────────────────────────────────

def parse_buffer(buffer: bytes, content_type: str, filename: str = "") -> dict:
    """
    Parse a file buffer into plain text.

    Returns:
        {"content": str, "metadata": dict}
    """
    ext = _normalize_type(content_type, filename)

    parsers = {
        "pdf": _parse_pdf,
        "txt": _parse_text,
        "md": _parse_text,
        "json": _parse_json,
        "docx": _parse_docx,
    }

    parser = parsers.get(ext)
    if parser is None:
        raise ValueError(f"Unsupported file type: {ext}")

    return parser(buffer, filename)


# ── Parsers ───────────────────────────────────────────────────────────

def _parse_pdf(buffer: bytes, filename: str) -> dict:
    if not _HAS_PDF:
        raise RuntimeError("pypdf not installed – cannot parse PDF")
    reader = PdfReader(BytesIO(buffer))
    pages = [page.extract_text() or "" for page in reader.pages]
    return {
        "content": _clean("\n\n".join(pages)),
        "metadata": {"pages": len(reader.pages), "filename": filename},
    }


def _parse_text(buffer: bytes, filename: str) -> dict:
    return {
        "content": _clean(buffer.decode("utf-8")),
        "metadata": {"filename": filename},
    }


def _parse_json(buffer: bytes, filename: str) -> dict:
    data = json.loads(buffer.decode("utf-8"))
    text = _json_to_text(data)
    return {
        "content": _clean(text),
        "metadata": {"filename": filename, "format": "json"},
    }


def _parse_docx(buffer: bytes, filename: str) -> dict:
    if not _HAS_DOCX:
        raise RuntimeError("python-docx not installed – cannot parse DOCX")
    doc = docx.Document(BytesIO(buffer))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    for table in doc.tables:
        paragraphs.extend(" | ".join(cell.text for cell in row.cells) for row in table.rows)
    return {
        "content": _clean("\n\n".join(paragraphs)),
        "metadata": {"filename": filename, "paragraphs": len(paragraphs)},
    }


# ── Helpers ───────────────────────────────────────────────────────────

def _json_to_text(data) -> str:
    """Convert various JSON shapes into readable text."""
    if isinstance(data, list):
        parts = []
        for item in data:
            if isinstance(item, dict):
                if "question" in item and "answer" in item:
                    parts.append(f"Q: {item['question']}\nA: {item['answer']}")
                elif "title" in item and "content" in item:
                    parts.append(f"{item['title']}\n{item['content']}")
                else:
                    parts.append(json.dumps(item, indent=2))
            elif isinstance(item, str):
                parts.append(item)
        return "\n\n".join(parts)
    elif isinstance(data, dict):
        return "\n\n".join(
            f"{k}: {v}" if isinstance(v, str) else f"{k}:\n{json.dumps(v, indent=2)}"
            for k, v in data.items()
        )
    return str(data)


def _normalize_type(content_type: str, filename: str) -> str:
    mime_map = {
        "application/pdf": "pdf",
        "text/plain": "txt",
        "text/markdown": "md",
        "application/json": "json",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    }
    if content_type in mime_map:
        return mime_map[content_type]
    # Fall back to extension
    ext = Path(filename).suffix.lstrip(".").lower()
    return ext if ext else content_type


def _clean(text: str) -> str:
    """Normalise whitespace."""
    lines = text.replace("\r\n", "\n").replace("\t", " ").split("\n")
    lines = [ln.strip() for ln in lines]
    text = "\n".join(lines)
    # Collapse 3+ newlines
    while "\n\n\n" in text:
        text = text.replace("\n\n\n", "\n\n")
    return text.strip()
