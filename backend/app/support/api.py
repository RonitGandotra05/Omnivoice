"""Tenant support tools plus stateless, side-effect-free studio previews."""
import uuid
import asyncio
import hashlib
from datetime import datetime, timezone, timedelta
from uuid import UUID
import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Header, UploadFile, File, Request
from sqlalchemy import select, update, or_, and_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.config.database import get_db
from app.models.models import Company, ApiKey
from app.support.models import SupportProfile, SupportDocument, SupportTicket, SupportDocumentDetails, SupportDocumentReview
from app.support.schemas import Profile, Document, Question, Preview, Escalation
from app.support.service import answer, voice_prompt, route_ticket
from app.support.mail import deliver
from app.utils.document_parser import get_supported_types
from app.utils.parse_async import parse_isolated
from app.config.settings import get_settings

router = APIRouter()
MAX_FILE = 10 * 1024 * 1024


async def tenant(company_id: UUID, request: Request, authorization: str | None = Header(None), db: AsyncSession = Depends(get_db)):
    supplied = (authorization or '').removeprefix('Bearer ')
    if not supplied or len(supplied.encode()) > 72:
        raise HTTPException(401, 'A company API key is required')
    company = await db.get(Company, company_id)
    if not company or not company.is_active:
        raise HTTPException(401, 'Invalid company or API key')
    keys = (await db.execute(select(ApiKey).where(ApiKey.company_id == company_id, ApiKey.is_active.is_(True)))).scalars().all()
    now = datetime.now(timezone.utc)
    for key in keys:
        expires = key.expires_at
        if expires and expires.replace(tzinfo=timezone.utc) <= now:
            continue
        try:
            valid = await asyncio.to_thread(bcrypt.checkpw, supplied.encode(), key.key_hash.encode())
        except ValueError:
            valid = False
        if valid:
            permission = 'voice_tools' if request.url.path.endswith('/caller-context') and 'voice_tools' in (key.permissions or []) else 'read' if request.method == 'GET' else 'write'
            # Searches are POST to avoid putting caller content into URLs/access logs.
            if request.url.path.endswith('/query'):
                permission = 'read'
            if permission not in (key.permissions or []):
                raise HTTPException(403, 'API key does not have the required permission')
            key.last_used_at = now
            return company
    raise HTTPException(401, 'Invalid company or API key')


async def profile_for(company, db):
    row = await db.get(SupportProfile, company.id)
    return Profile.model_validate(row.configuration) if row else Profile(company_name=company.name,
        greeting=company.greeting or Profile.model_fields['greeting'].default,
        support_email=company.contact_email or 'support@example.com')


async def documents_for(company_id, db):
    return (await db.execute(select(SupportDocument).where(SupportDocument.company_id == company_id).order_by(SupportDocument.created_at.desc()))).scalars().all()


async def parse_upload(file):
    from app.security.uploads import filename_extension
    try:
        ext = filename_extension(file.filename)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if ext not in get_supported_types():
        raise HTTPException(422, 'Use PDF, DOCX, TXT, Markdown, or JSON documents.')
    raw = await file.read(MAX_FILE + 1)
    if len(raw) > MAX_FILE:
        raise HTTPException(413, 'Maximum document size is 10 MB.')
    parsed = await parse_isolated(raw, ext)
    try:
        doc = Document(name=(file.filename or 'document')[:255], content=parsed['content'])
    except ValueError as exc:
        raise HTTPException(422, 'This document does not contain enough readable text.') from exc
    return doc, parsed.get('metadata', {}), hashlib.sha256(raw).hexdigest()


def require_demo():
    if not get_settings().public_demo_enabled:
        raise HTTPException(403, 'The public demo is disabled. Use an authenticated company workspace.')


async def review_rows(company_id, db):
    return (await db.execute(select(SupportDocumentReview).where(SupportDocumentReview.company_id == company_id))).scalars().all()


async def capacity(company_id, incoming, db):
    # UPDATE obtains a write lock on SQLite and a row lock on PostgreSQL.
    await db.execute(update(Company).where(Company.id == company_id).values(updated_at=Company.updated_at))
    docs = await documents_for(company_id, db)
    reviews = await review_rows(company_id, db)
    settings = get_settings()
    if len(docs) + len(reviews) >= settings.max_documents or sum(len(d.content) for d in [*docs, *reviews]) + incoming > settings.max_workspace_characters:
        raise HTTPException(409, f'Workspace limit reached: {settings.max_documents} documents or {settings.max_workspace_characters:,} characters. Remove old documents or split oversized files.')


@router.get('/capabilities')
async def capabilities():
    settings = get_settings()
    from app.utils.ocr import availability
    return {'max_documents': settings.max_documents, 'max_workspace_characters': settings.max_workspace_characters,
        'max_file_bytes': MAX_FILE, 'ocr_available': settings.ocr_enabled and await asyncio.to_thread(availability, settings.ocr_languages),
        'public_demo_enabled': settings.public_demo_enabled}


@router.post('/preview')
async def preview(body: Preview):
    require_demo()
    result = await asyncio.to_thread(answer, body.query, body.profile, body.documents)
    return {**result, 'preview': True, 'email_sent': False}


@router.post('/parse')
async def parse(file: UploadFile = File(...)):
    require_demo()
    doc, metadata, _ = await parse_upload(file)
    return {**doc.model_dump(), 'metadata': metadata, 'status': 'needs_review' if metadata.get('needs_review') else 'ready'}


@router.get('/{company_id}/workspace')
async def workspace(company: Company = Depends(tenant), db: AsyncSession = Depends(get_db)):
    profile = await profile_for(company, db)
    documents = await documents_for(company.id, db)
    tickets = (await db.execute(select(SupportTicket).where(SupportTicket.company_id == company.id).order_by(SupportTicket.created_at.desc()).limit(100))).scalars().all()
    details = (await db.execute(select(SupportDocumentDetails).where(SupportDocumentDetails.company_id == company.id))).scalars().all()
    quality = {row.document_id: row.quality for row in details}
    documents_json = [{'id': str(d.id), 'name': d.name, 'content': d.content, 'status': 'ready', 'metadata': quality.get(d.id, {})} for d in documents]
    documents_json += [{'id': str(d.id), 'name': d.name, 'content': d.content, 'status': 'needs_review', 'metadata': d.quality} for d in await review_rows(company.id, db)]
    from app.support.models import SupportCaller
    from app.support.callers import caller_json
    callers = (await db.execute(select(SupportCaller).where(SupportCaller.company_id == company.id).order_by(SupportCaller.updated_at.desc()).limit(100))).scalars().all()
    return {'callers': [caller_json(row) for row in callers], 'profile': profile.model_dump(), 'documents': documents_json,
        'tickets': [ticket_json(t) for t in tickets], 'prompt': voice_prompt(profile)}


@router.put('/{company_id}/profile')
async def save_profile(body: Profile, company: Company = Depends(tenant), db: AsyncSession = Depends(get_db)):
    await db.execute(update(Company).where(Company.id == company.id).values(updated_at=Company.updated_at))
    row = await db.get(SupportProfile, company.id)
    if not row:
        row = SupportProfile(company_id=company.id)
        db.add(row)
    row.configuration = body.model_dump()
    await db.flush()
    return {'profile': body.model_dump(), 'prompt': voice_prompt(body)}


@router.post('/{company_id}/documents', status_code=201)
async def upload(file: UploadFile = File(...), company: Company = Depends(tenant), db: AsyncSession = Depends(get_db)):
    await db.commit()  # Do not keep a DB transaction open while OCR runs.
    doc, quality, fingerprint = await parse_upload(file)
    # Lock before duplicate checks so simultaneous retries produce one document.
    await db.execute(update(Company).where(Company.id == company.id).values(updated_at=Company.updated_at))
    previous = (await db.execute(select(SupportDocumentDetails).where(SupportDocumentDetails.company_id == company.id, SupportDocumentDetails.fingerprint == fingerprint))).scalar_one_or_none()
    if previous:
        existing = await db.get(SupportDocument, previous.document_id)
        return {'id': str(existing.id), 'name': existing.name, 'content': existing.content, 'metadata': previous.quality, 'status': 'ready', 'duplicate': True}
    review = (await db.execute(select(SupportDocumentReview).where(SupportDocumentReview.company_id == company.id, SupportDocumentReview.fingerprint == fingerprint))).scalar_one_or_none()
    if review:
        return {'id': str(review.id), 'name': review.name, 'content': review.content, 'metadata': review.quality, 'status': 'needs_review', 'duplicate': True}
    await capacity(company.id, len(doc.content), db)
    if quality.get('needs_review'):
        row = SupportDocumentReview(company_id=company.id, fingerprint=fingerprint, quality=quality, **doc.model_dump())
        db.add(row)
        await db.flush()
        return {'id': str(row.id), **doc.model_dump(), 'metadata': quality, 'status': 'needs_review'}
    row = SupportDocument(company_id=company.id, **doc.model_dump())
    db.add(row)
    await db.flush()
    db.add(SupportDocumentDetails(document_id=row.id, company_id=company.id, fingerprint=fingerprint, quality=quality))
    await db.flush()
    return {'id': str(row.id), **doc.model_dump(), 'metadata': quality, 'status': 'ready'}


@router.post('/{company_id}/documents/{document_id}/approve')
async def approve(document_id: UUID, body: Document, company: Company = Depends(tenant), db: AsyncSession = Depends(get_db)):
    await db.execute(update(Company).where(Company.id == company.id).values(updated_at=Company.updated_at))
    row = await db.get(SupportDocumentReview, document_id)
    if not row or row.company_id != company.id:
        raise HTTPException(404, 'Document awaiting review not found')
    existing = await documents_for(company.id, db)
    reviews = await review_rows(company.id, db)
    if sum(len(d.content) for d in [*existing, *reviews]) - len(row.content) + len(body.content) > get_settings().max_workspace_characters:
        raise HTTPException(409, 'Workspace text limit exceeded.')
    quality = {**row.quality, 'needs_review': False, 'reviewed': True}
    document = SupportDocument(id=row.id, company_id=company.id, name=row.name, content=body.content)
    db.add(document)
    await db.flush()
    db.add(SupportDocumentDetails(document_id=row.id, company_id=company.id, fingerprint=row.fingerprint, quality=quality))
    await db.delete(row)
    await db.flush()
    return {'id': str(document.id), 'name': document.name, 'content': document.content, 'metadata': quality, 'status': 'ready'}


@router.delete('/{company_id}/documents/{document_id}')
async def remove(document_id: UUID, company: Company = Depends(tenant), db: AsyncSession = Depends(get_db)):
    await db.execute(update(Company).where(Company.id == company.id).values(updated_at=Company.updated_at))
    row = await db.get(SupportDocument, document_id)
    if not row:
        row = await db.get(SupportDocumentReview, document_id)
    if not row or row.company_id != company.id:
        raise HTTPException(404, 'Document not found')
    details = await db.get(SupportDocumentDetails, document_id)
    if details:
        await db.delete(details)
    await db.delete(row)
    return {'deleted': True}


@router.post('/{company_id}/query')
async def query(body: Question, company: Company = Depends(tenant), db: AsyncSession = Depends(get_db)):
    profile, documents = await profile_for(company, db), await documents_for(company.id, db)
    return await asyncio.to_thread(answer, body.query, profile, documents)


def ticket_json(ticket):
    return {key: str(getattr(ticket, key)) if key in ('id', 'created_at') else getattr(ticket, key)
        for key in ('id', 'subject', 'summary', 'customer_email', 'customer_phone', 'priority', 'team', 'recipient', 'status', 'delivery_status', 'delivery_error', 'attempts', 'created_at')}


async def dispatch(ticket, db):
    # Atomic delivery lease prevents simultaneous retries from sending twice.
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=2)
    claimed = await db.execute(update(SupportTicket).where(SupportTicket.id == ticket.id,
        or_(SupportTicket.delivery_status.in_(['pending', 'not_configured', 'failed']),
            and_(SupportTicket.delivery_status == 'sending', SupportTicket.delivery_started_at < cutoff)))
        .values(delivery_status='sending', delivery_started_at=datetime.now(timezone.utc)).execution_options(synchronize_session=False))
    await db.commit()
    await db.refresh(ticket)
    if claimed.rowcount:
        await deliver(ticket)
        await db.commit()
    return ticket_json(ticket)


@router.post('/{company_id}/escalations', status_code=201)
async def escalate(body: Escalation, company: Company = Depends(tenant), db: AsyncSession = Depends(get_db)):
    previous = (await db.execute(select(SupportTicket).where(SupportTicket.company_id == company.id, SupportTicket.idempotency_key == body.idempotency_key))).scalar_one_or_none()
    if previous:
        return {'ticket': ticket_json(previous), 'duplicate': True}
    routing = route_ticket(await profile_for(company, db), body.subject + ' ' + body.summary)
    ticket = SupportTicket(company_id=company.id, **body.model_dump(), **routing)
    db.add(ticket)
    try:
        await db.commit()  # Durable before attempting external email delivery.
    except IntegrityError:
        await db.rollback()
        previous = (await db.execute(select(SupportTicket).where(SupportTicket.company_id == company.id, SupportTicket.idempotency_key == body.idempotency_key))).scalar_one()
        return {'ticket': ticket_json(previous), 'duplicate': True}
    return {'ticket': await dispatch(ticket, db), 'duplicate': False}


@router.post('/{company_id}/escalations/{ticket_id}/retry')
async def retry(ticket_id: UUID, company: Company = Depends(tenant), db: AsyncSession = Depends(get_db)):
    ticket = await db.get(SupportTicket, ticket_id)
    if not ticket or ticket.company_id != company.id:
        raise HTTPException(404, 'Ticket not found')
    return {'ticket': await dispatch(ticket, db)}
