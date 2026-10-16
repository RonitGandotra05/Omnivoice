"""Durable tenant publishing queue with renewable, database-shared leases."""
import asyncio
import logging
import uuid
from contextlib import suppress
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession
from app.config.database import get_db, async_session
from app.config.settings import get_settings
from app.models.models import Company
from app.support.api import tenant, documents_for, review_rows
from app.support.models import SupportPublishJob, SupportRelease
from app.support.checks import workspace_revision, publication_gate

router = APIRouter()
logger = logging.getLogger(__name__)


def now():
    return datetime.now(timezone.utc)


def serialize(row):
    return {'job_id': str(row.job_id), 'status': row.status, 'result': row.result or {}, 'error': row.error}


async def revision(company, db):
    return await workspace_revision(company, db)


@router.post('/{company_id}/voice/sync', status_code=202, deprecated=True)
@router.post('/{company_id}/voice/publish', status_code=202)
async def enqueue(company: Company = Depends(tenant), db: AsyncSession = Depends(get_db)):
    if not get_settings().web_voice_enabled:
        raise HTTPException(403, 'Voice publishing is not enabled for this installation.')
    from app.utils.elevenlabs_client import company_agent_id
    try:
        company_agent_id(company.id)
    except ValueError as exc:
        raise HTTPException(409, 'Configure a unique voice agent for this company before publishing.') from exc
    await db.execute(update(Company).where(Company.id == company.id).values(updated_at=Company.updated_at))
    if await review_rows(company.id, db):
        raise HTTPException(409, 'Review or remove flagged documents before publishing company knowledge.')
    await publication_gate(company, db)
    row = await db.get(SupportPublishJob, company.id)
    if row and row.status in ('queued', 'running'):
        return serialize(row)
    if not row:
        row = SupportPublishJob(company_id=company.id)
        db.add(row)
    row.job_id, row.status, row.owner, row.lease_until = uuid.uuid4(), 'queued', None, None
    row.result, row.error, row.updated_at = {}, None, now()
    await db.flush()
    return serialize(row)


def release_json(row):
    return {'id': str(row.id), 'revision': row.revision, 'published_at': row.published_at.isoformat(),
        'document_count': row.document_count, 'checks_passed': row.checks_passed, 'checks_total': row.checks_total}


@router.get('/{company_id}/voice/publish')
async def progress(company: Company = Depends(tenant), db: AsyncSession = Depends(get_db)):
    row = await db.get(SupportPublishJob, company.id)
    data = serialize(row) if row else {'status': 'not_published', 'result': {}}
    latest = (await db.execute(select(SupportRelease).where(SupportRelease.company_id == company.id)
        .order_by(SupportRelease.published_at.desc(), SupportRelease.id.desc()).limit(1))).scalar_one_or_none()
    if latest:
        data['publication'] = release_json(latest)
        data['result'] = {**data['result'], 'needs_publish': latest.revision != await revision(company, db)}
    return data


@router.get('/{company_id}/voice/releases')
async def releases(company: Company = Depends(tenant), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(SupportRelease).where(SupportRelease.company_id == company.id)
        .order_by(SupportRelease.published_at.desc(), SupportRelease.id.desc()).limit(10))).scalars().all()
    return {'releases': [release_json(row) for row in rows]}


async def process_once(sessions=async_session, publish=None):
    """Claim at most one job; returning False means there was no work."""
    async with sessions() as db:
        eligible = or_(SupportPublishJob.status == 'queued', and_(SupportPublishJob.status == 'running', SupportPublishJob.lease_until < now()))
        row = (await db.execute(select(SupportPublishJob).where(eligible).order_by(SupportPublishJob.updated_at).limit(1))).scalar_one_or_none()
        if not row:
            return False
        company_id, job_id, owner = row.company_id, row.job_id, uuid.uuid4().hex
        claimed = await db.execute(update(SupportPublishJob).where(SupportPublishJob.company_id == company_id, eligible)
            .values(status='running', owner=owner, lease_until=now() + timedelta(minutes=2), updated_at=now()).execution_options(synchronize_session=False))
        await db.commit()
        if not claimed.rowcount:
            return False
    async def execute():
        async with sessions() as db:
            company = await db.get(Company, company_id)
            if not company or not company.is_active:
                raise ValueError('Company is inactive.')
            checks = await publication_gate(company, db)
            before = await revision(company, db)
            if checks['revision'] != before:
                raise RuntimeError('Workspace changed after its knowledge checks. Retry publishing.')
            if publish is None:
                from app.support.voice import sync
                result = await sync(company=company, db=db)
            else:
                result = await publish(company, db)
            await db.commit()
            # Re-read after provider work; stale local identity-map rows must not hide edits.
            db.expire_all()
            company = await db.get(Company, company_id)
            after = await revision(company, db)
            receipt = SupportRelease(company_id=company_id, revision=before,
                document_count=result.get('synced', len(await documents_for(company_id, db))),
                checks_passed=checks['passed'], checks_total=checks['total'])
            db.add(receipt)
            await db.flush()
            # Keep the latest ten receipts per company; only the worker writes these.
            old = (await db.execute(select(SupportRelease).where(SupportRelease.company_id == company_id)
                .order_by(SupportRelease.published_at.desc(), SupportRelease.id.desc()).offset(10))).scalars().all()
            for item in old:
                await db.delete(item)
            await db.commit()
            return {**result, 'needs_publish': before != after, 'published_revision': before,
                'checks': {'status': checks['status'], 'passed': checks['passed'], 'total': checks['total']}}
    task = asyncio.create_task(execute())
    try:
        while not task.done():
            done, _ = await asyncio.wait([task], timeout=15)
            if done:
                break
            async with sessions() as db:
                renewed = await db.execute(update(SupportPublishJob).where(SupportPublishJob.company_id == company_id, SupportPublishJob.owner == owner, SupportPublishJob.job_id == job_id)
                    .values(lease_until=now() + timedelta(minutes=2), updated_at=now()))
                await db.commit()
            if not renewed.rowcount:
                raise RuntimeError('Publishing lease was lost.')
        result = await task
        status, error = 'complete', None
    except asyncio.CancelledError:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        # Leave the lease for another worker to recover after expiry.
        raise
    except Exception:
        task.cancel()
        with suppress(asyncio.CancelledError, Exception):
            await task
        result, status, error = {}, 'failed', 'Publishing did not complete. Check voice configuration and retry; verified local documents are retained.'
        logger.warning('Company knowledge publishing failed for job %s', job_id)
    async with sessions() as db:
        await db.execute(update(SupportPublishJob).where(SupportPublishJob.company_id == company_id, SupportPublishJob.owner == owner, SupportPublishJob.job_id == job_id)
            .values(status=status, result=result, error=error, lease_until=None, owner=None, updated_at=now()))
        await db.commit()
    return True


async def worker():
    while True:
        try:
            worked = await process_once()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning('Publishing queue temporarily unavailable.')
            worked = False
        if not worked:
            await asyncio.sleep(2)
