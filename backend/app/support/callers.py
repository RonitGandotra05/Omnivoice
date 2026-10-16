"""Tenant-scoped caller intake and truthful, server-clock handoff decisions."""
import hashlib
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.config.database import get_db
from app.models.models import Company
from app.support.api import tenant, profile_for, dispatch
from app.support.models import SupportCaller, SupportTicket
from app.support.schemas import CallerUpdate, Profile
from app.support.service import route_ticket

router = APIRouter()


def boundary(day, clock, zone, closing=False):
    """Resolve ambiguous times conservatively; advance nonexistent DST times."""
    naive = datetime.fromisoformat(f'{day.isoformat()}T{clock}')
    for _ in range(181):
        candidates = []
        for fold in (0, 1):
            value = naive.replace(tzinfo=zone, fold=fold).astimezone(timezone.utc)
            if value.astimezone(zone).replace(tzinfo=None) == naive:
                candidates.append(value)
        if candidates:
            # Shorter availability at ambiguous boundaries avoids promising staff.
            return min(candidates) if closing else max(candidates)
        naive += timedelta(minutes=1)
    raise ValueError('Unable to resolve business hours')


def availability(profile, instant=None):
    instant = instant or datetime.now(timezone.utc)
    if instant.tzinfo is None:
        raise ValueError('Availability requires an aware server timestamp')
    instant = instant.astimezone(timezone.utc)
    zone = ZoneInfo(profile.timezone)
    local = instant.astimezone(zone)
    result = {'timezone': profile.timezone, 'local_time': local.isoformat(),
        'status': 'unknown', 'next_open': None, 'closes_at': None,
        'transfer_configured': bool(profile.human_phone), 'available': False}
    if not profile.hours_enabled:
        return {**result, 'message': 'Human support hours are not configured. Save a follow-up request; do not promise availability.'}
    intervals = []
    for offset in range(-1, 69):
        day = local.date() + timedelta(days=offset)
        if day.isoformat() in profile.holidays:
            continue
        for window in profile.office_hours:
            if window.day != day.weekday():
                continue
            end_day = day + timedelta(days=window.closes < window.opens)
            start = boundary(day, window.opens, zone)
            # A holiday also truncates the prior day's overnight shift.
            end = boundary(end_day, '00:00' if end_day.isoformat() in profile.holidays else window.closes, zone, True)
            if end > start:
                intervals.append((start, end))
    # Merge overlapping shifts so next closing is meaningful.
    merged = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    for start, end in merged:
        if start <= instant < end:
            return {**result, 'status': 'open', 'available': bool(profile.human_phone),
                'closes_at': end.astimezone(zone).isoformat(),
                'message': 'Within configured support hours. Staff presence and transfer success are not guaranteed.'}
    upcoming = next((start for start, _ in merged if start > instant), None)
    return {**result, 'status': 'closed', 'next_open': upcoming.astimezone(zone).isoformat() if upcoming else None,
        'message': 'Human support is closed. Offer a callback request for the next opening; this is not a booked appointment.'}


def caller_json(row):
    return {'id': str(row.id), 'conversation_id': row.conversation_id, **row.details,
        'ticket_id': str(row.ticket_id) if row.ticket_id else None,
        'created_at': row.created_at.isoformat(), 'updated_at': row.updated_at.isoformat(),
        'identity': 'self_reported', 'saved': True}


@router.get('/{company_id}/availability')
async def support_availability(company: Company = Depends(tenant), db: AsyncSession = Depends(get_db)):
    return availability(await profile_for(company, db))


@router.get('/{company_id}/callers')
async def callers(company: Company = Depends(tenant), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(SupportCaller).where(SupportCaller.company_id == company.id).order_by(SupportCaller.updated_at.desc()).limit(100))).scalars().all()
    return {'callers': [caller_json(row) for row in rows]}


@router.get('/{company_id}/callers/{conversation_id}')
async def caller(conversation_id: str, company: Company = Depends(tenant), db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(SupportCaller).where(SupportCaller.company_id == company.id, SupportCaller.conversation_id == conversation_id))).scalar_one_or_none()
    return {'caller': caller_json(row) if row else None}


@router.post('/{company_id}/caller-context')
async def caller_context(body: CallerUpdate, company: Company = Depends(tenant), db: AsyncSession = Depends(get_db)):
    profile = await profile_for(company, db)
    current = availability(profile)
    if body.action == 'availability':
        return {'availability': current}
    if body.action == 'handoff':
        from app.config.protection import consume_quota
        from app.config.settings import get_settings
        if get_settings().rate_limit_enabled:
            allowed, retry = await consume_quota(str(company.id), 'caller_handoff', 30)
            if not allowed:
                raise HTTPException(429, 'Too many human requests. Retry shortly.', headers={'Retry-After': str(retry)})
    # Serialize a company's intake writes, including duplicate handoff requests.
    await db.execute(update(Company).where(Company.id == company.id).values(updated_at=Company.updated_at))
    row = (await db.execute(select(SupportCaller).where(SupportCaller.company_id == company.id, SupportCaller.conversation_id == body.conversation_id))).scalar_one_or_none()
    if not row:
        row = SupportCaller(company_id=company.id, conversation_id=body.conversation_id, details={})
        db.add(row)
    details = body.model_dump(exclude={'action', 'conversation_id'})
    # Tool sends a complete snapshot; consent withdrawal clears stored contact fields.
    row.details = {**(row.details or {}), **details}
    if row.details.get('handoff') == 'callback_requested' and not (body.consent and (body.phone or body.email)):
        row.details = {**row.details, 'handoff': 'follow_up_requested'}
    row.updated_at = datetime.now(timezone.utc)
    ticket = await db.get(SupportTicket, row.ticket_id) if row.ticket_id else None
    if body.action == 'handoff':
        transfer = current['available'] and not body.callback_requested
        decision = 'transfer_available' if transfer else 'callback_requested' if body.callback_requested and body.consent and (body.phone or body.email) else 'follow_up_requested'
        row.details = {**details, 'handoff': decision, 'suggested_callback_at': current['next_open'],
            'callback_booked': False, 'availability_at_request': current}
        summary = '\n'.join([f'Caller: {body.name or "Not provided"}', f'Reason: {body.reason or "Caller requested a human"}', f'Conversation: {body.conversation_id}',
                f'Request: {decision}', f'Callback preference: {body.callback_preference or "Not provided"}',
                f'Next opening: {current["next_open"] or "Not specified"} ({profile.timezone})',
                'A callback request is not a confirmed appointment. Contact details are self-reported.'])
        if not ticket:
            ticket = SupportTicket(company_id=company.id, idempotency_key='caller-' + hashlib.sha256(body.conversation_id.encode()).hexdigest(),
                subject='Caller requested human support', summary=summary,
                customer_email=str(body.email) if body.email else None, customer_phone=body.phone,
                transcript='', priority='normal', **route_ticket(profile, body.reason))
            db.add(ticket)
            await db.flush()
            row.ticket_id = ticket.id
        else:
            # Corrections and late contact capture reach the durable support queue.
            ticket.summary = summary
            ticket.customer_phone = body.phone
            ticket.customer_email = str(body.email) if body.email else None
        await db.commit()  # Persist caller and queue item together, before SMTP.
        result = await dispatch(ticket, db)
        return {'caller': caller_json(row), 'availability': current, 'ticket': result,
            'decision': decision, 'transfer_number': profile.human_phone if transfer else None,
            'message': 'Request saved. Transfer available only on a connected phone call.' if transfer else 'Request saved for the team. No callback appointment has been booked.'}
    if ticket:
        ticket.customer_phone = body.phone
        ticket.customer_email = str(body.email) if body.email else None
        ticket.summary = '\n'.join([f'Caller: {body.name or "Not provided"}', f'Reason: {body.reason or "Caller requested a human"}', f'Conversation: {body.conversation_id}', f'Request: {row.details.get("handoff") or "follow_up_requested"}', f'Callback preference: {body.callback_preference or "Not provided"}', 'A callback request is not a confirmed appointment. Contact details are self-reported.'])
    await db.commit()
    return {'caller': caller_json(row), 'availability': current}


class JourneyPreview(CallerUpdate):
    profile: Profile
    at: datetime | None = None


@router.post('/preview-caller')
async def preview_caller(body: JourneyPreview):
    from app.support.api import require_demo
    require_demo()
    if body.at and body.at.tzinfo is None:
        raise HTTPException(422, 'Use a timestamp with a timezone offset')
    current = availability(body.profile, body.at)
    decision = None
    if body.action == 'handoff':
        decision = 'transfer_available' if current['available'] and not body.callback_requested else 'callback_requested' if body.callback_requested and body.consent and (body.phone or body.email) else 'follow_up_requested'
    return {'availability': current, 'decision': decision,
        'caller': {**body.model_dump(exclude={'action', 'profile', 'at'}), 'saved': False,
            'identity': 'self_reported', 'handoff': decision, 'callback_booked': False,
            'suggested_callback_at': current['next_open']},
        'message': 'Preview only. No database record, email, transfer or callback booking was created.'}
