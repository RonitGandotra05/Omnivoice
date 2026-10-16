"""Strict passive-document validation; never extract archives onto the filesystem."""
import re
import stat
import zipfile
from io import BytesIO
from pathlib import PurePosixPath
from lxml import etree

MAX_FILE = 10 * 1024 * 1024
MAX_EXPANDED = 40 * 1024 * 1024
MAX_MEMBER = 8 * 1024 * 1024


def filename_extension(name):
    if not name or len(name) > 255 or any(ord(c) < 32 for c in name) or any(c in name for c in '/\\:'):
        raise ValueError('Use a plain filename without paths, control characters or colons.')
    ext = name.rsplit('.', 1)[-1].lower()
    if ext not in {'pdf', 'docx', 'txt', 'md', 'json'}:
        raise ValueError('Only PDF, DOCX, TXT, Markdown and JSON documents are accepted.')
    return ext


def validate_passive(raw, ext):
    if not raw or len(raw) > MAX_FILE:
        raise ValueError('Upload a non-empty document no larger than 10 MB.')
    if ext == 'docx':
        validate_docx(raw)
    elif ext == 'pdf':
        if not raw.startswith(b'%PDF-'):
            raise ValueError('The file is not a valid PDF.')
    elif ext in {'txt', 'md', 'json'}:
        text = raw.decode('utf-8-sig')
        if '\x00' in text or sum(ord(c) < 32 and c not in '\n\r\t' for c in text):
            raise ValueError('Binary content is not accepted as a text document.')
        if text.lstrip().startswith(('MZ', '%PDF-', 'PK\x03\x04', '#!')):
            raise ValueError('Executable or disguised document content is not accepted.')
    else:
        raise ValueError('Unsupported document type.')


def validate_docx(raw):
    if not raw.startswith(b'PK\x03\x04'):
        raise ValueError('The file is not a valid DOCX.')
    total = 0
    try:
        with zipfile.ZipFile(BytesIO(raw)) as archive:
            entries = archive.infolist()
            names = [entry.filename for entry in entries]
            if len(entries) > 2000 or len(set(names)) != len(names):
                raise ValueError('DOCX has excessive or duplicate archive entries.')
            if not {'[Content_Types].xml', 'word/document.xml'}.issubset(names):
                raise ValueError('DOCX required content is missing.')
            for entry in entries:
                path = PurePosixPath(entry.filename)
                lower = entry.filename.lower()
                if path.is_absolute() or '..' in path.parts or '\\' in lower or ':' in lower or '\x00' in lower or stat.S_ISLNK(entry.external_attr >> 16):
                    raise ValueError('Unsafe archive member path.')
                if entry.flag_bits & 1 or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                    raise ValueError('Encrypted or unsupported archive compression.')
                if entry.is_dir():
                    continue
                if entry.file_size > MAX_MEMBER or entry.file_size > max(1, entry.compress_size) * 100:
                    raise ValueError('DOCX exceeds safe expansion or compression-ratio limits.')
                total += entry.file_size
                if total > MAX_EXPANDED:
                    raise ValueError('DOCX expanded contents exceed the safe size limit.')
                if any(part in lower for part in ('vbaproject', 'activex/', 'embeddings/', 'attachedtemplate', 'customui/')) or lower.endswith(('.zip','.exe','.dll','.bin','.js','.vbs','.ps1','.jar','.html','.hta','.svg')):
                    raise ValueError('Macros, active content and embedded files are not accepted.')
                if not lower.endswith(('.xml', '.rels', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tif', '.tiff')):
                    raise ValueError('Unsupported embedded DOCX content.')
                # Read with a real inflation bound and CRC check, not only ZIP metadata.
                with archive.open(entry) as source:
                    payload = source.read(MAX_MEMBER + 1)
                if len(payload) > MAX_MEMBER or len(payload) != entry.file_size:
                    raise ValueError('DOCX archive size does not match its contents.')
                if lower.endswith(('.xml', '.rels')):
                    parser = etree.XMLParser(resolve_entities=False, load_dtd=False, no_network=True, huge_tree=False)
                    tree = etree.fromstring(payload, parser)
                    if tree.getroottree().docinfo.doctype:
                        raise ValueError('XML DTDs and entities are not accepted.')
                    for node in tree.iter():
                        if not isinstance(node.tag, str):
                            continue
                        if node.get('TargetMode', '').lower() == 'external':
                            raise ValueError('External DOCX relationships are not accepted. Remove external links/templates first.')
                        if etree.QName(node).localname in {'instrText', 'fldSimple', 'altChunk', 'object'}:
                            raise ValueError('DOCX fields, linked content and embedded objects are not accepted.')
                    if b'macroenabled' in payload.lower() or b'vbaproject' in payload.lower():
                        raise ValueError('Macro-enabled DOCX content is not accepted.')
    except (zipfile.BadZipFile, etree.XMLSyntaxError, RuntimeError, NotImplementedError) as exc:
        raise ValueError('DOCX archive or XML is malformed.') from exc


def validate_pdf_objects(reader):
    from pypdf.generic import IndirectObject, DictionaryObject, ArrayObject
    dangerous = {'/JS','/JavaScript','/OpenAction','/AA','/EmbeddedFiles','/EF','/Launch','/RichMedia','/XFA','/SubmitForm','/ImportData'}
    actions = {'/JavaScript','/Launch','/GoToR','/GoToE','/URI','/SubmitForm','/ImportData','/Rendition'}
    pending = [reader.trailer]
    visited = set()
    count = 0
    while pending:
        value = pending.pop()
        count += 1
        if count > 50000:
            raise ValueError('PDF object graph exceeds the safe complexity limit.')
        if isinstance(value, IndirectObject):
            identity = (value.idnum, value.generation)
            if identity in visited:
                continue
            visited.add(identity)
            value = value.get_object()
        if isinstance(value, DictionaryObject):
            if dangerous.intersection(value.keys()) or str(value.get('/S','')) in actions or str(value.get('/Type','')) == '/EmbeddedFile':
                raise ValueError('PDF scripts, automatic actions, attachments and external actions are not accepted.')
            pending.extend(value.values())
        elif isinstance(value, ArrayObject):
            pending.extend(value)
