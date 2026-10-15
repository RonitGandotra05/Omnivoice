"""Tenant support tools plus stateless, side-effect-free studio previews."""
import uuid
from datetime import datetime, timezone, timedelta
from uuid import UUID
import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Header, UploadFile, File, Request
from sqlalchemy import select, update, or_, and_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.config.database import get_db
from app.models.models import Company, ApiKey
from app.support.models import SupportProfile, SupportDocument, SupportTicket
from app.support.schemas import Profile, Document, Question, Preview, Escalation
from app.support.service import answer, voice_prompt, route_ticket
from app.support.mail import deliver
from app.utils.document_parser import parse_buffer, get_supported_types

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
            valid = bcrypt.checkpw(supplied.encode(), key.key_hash.encode())
        except ValueError:
            valid = False
        if valid:
            permission = 'read' if request.method == 'GET' else 'write'
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
    ext = (file.filename or '').rsplit('.', 1)[-1].lower()
    if ext not in get_supported_types():
        raise HTTPException(422, 'Use PDF, DOCX, TXT, Markdown, or JSON documents.')
    raw = await file.read(MAX_FILE + 1)
    if len(raw) > MAX_FILE:
        raise HTTPException(413, 'Maximum document size is 10 MB.')
    try:
        parsed = parse_buffer(raw, ext, file.filename or 'document')
        return Document(name=(file.filename or 'document')[:255], content=parsed['content'])
    except Exception as exc:
        raise HTTPException(422, 'Cannot read this document. Provide a text-based document with 10–200,000 characters; scanned PDFs need OCR.') from exc


@router.post('/preview')
async def preview(body: Preview):
    return {**answer(body.query, body.profile, body.documents), 'preview': True, 'email_sent': False}


@router.post('/parse')
async def parse(file: UploadFile = File(...)):
    return (await parse_upload(file)).model_dump()


@router.get('/{company_id}/workspace')
async def workspace(company: Company = Depends(tenant), db: AsyncSession = Depends(get_db)):
    profile = await profile_for(company, db)
    documents = await documents_for(company.id, db)
    tickets = (await db.execute(select(SupportTicket).where(SupportTicket.company_id == company.id).order_by(SupportTicket.created_at.desc()).limit(100))).scalars().all()
    return {'profile': profile.model_dump(), 'documents': [{'id': str(d.id), 'name': d.name, 'content': d.content} for d in documents],
        'tickets': [ticket_json(t) for t in tickets], 'prompt': voice_prompt(profile)}


@router.put('/{company_id}/profile')
async def save_profile(body: Profile, company: Company = Depends(tenant), db: AsyncSession = Depends(get_db)):
    row = await db.get(SupportProfile, company.id)
    if not row:
        row = SupportProfile(company_id=company.id)
        db.add(row)
    row.configuration = body.model_dump()
    await db.flush()
    return {'profile': body.model_dump(), 'prompt': voice_prompt(body)}


@router.post('/{company_id}/documents', status_code=201)
async def upload(file: UploadFile = File(...), company: Company = Depends(tenant), db: AsyncSession = Depends(get_db)):
    doc = await parse_upload(file)
    # Serialize tenant mutations to enforce the aggregate size cap under concurrency.
    await db.execute(select(Company.id).where(Company.id == company.id).with_for_update())
    existing = await documents_for(company.id, db)
    if len(existing) >= 30 or sum(len(d.content) for d in existing) + len(doc.content) > 500000:
        raise HTTPException(409, 'Workspace limit reached: 30 documents or 500,000 characters. Split into separate company workspaces or remove old documents.')
    row = SupportDocument(company_id=company.id, **doc.model_dump())
    db.add(row)
    await db.flush()
    return {'id': str(row.id), **doc.model_dump()}


@router.delete('/{company_id}/documents/{document_id}')
async def remove(document_id: UUID, company: Company = Depends(tenant), db: AsyncSession = Depends(get_db)):
    row = await db.get(SupportDocument, document_id)
    if not row or row.company_id != company.id:
        raise HTTPException(404, 'Document not found')
    await db.delete(row)
    return {'deleted': True}


@router.post('/{company_id}/query')
async def query(body: Question, company: Company = Depends(tenant), db: AsyncSession = Depends(get_db)):
    return answer(body.query, await profile_for(company, db), await documents_for(company.id, db))


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
