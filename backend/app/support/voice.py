"""ElevenLabs conversation sessions, native knowledge sync, and signed call tracking."""
import hashlib
import hmac
import json
import time
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.config.database import get_db
from app.config.settings import get_settings
from app.models.models import Company
from app.support.api import tenant, profile_for, documents_for
from app.support.models import SupportConversation, SupportVoiceDocument, SupportDocument, SupportCheckSuite
from app.support.service import voice_prompt
from app.support.schemas import Profile
from app.utils.elevenlabs_client import company_agent_id, provider_request, attach_knowledge, detach_knowledge, ensure_indexed

router = APIRouter()


@router.post('/{company_id}/voice/session')
async def session(company: Company = Depends(tenant)):
    if not get_settings().web_voice_enabled:
        raise HTTPException(403, 'Enable WEB_VOICE_ENABLED after configuring your company agent.')
    try:
        agent_id = company_agent_id(company.id)
        result = await provider_request('GET', '/conversation/get-signed-url', params={'agent_id': agent_id})
        return {'signed_url': result['signed_url']}
    except (ValueError, RuntimeError, KeyError) as exc:
        raise HTTPException(503, 'Company voice session is unavailable. Check the dedicated agent mapping and credentials.') from exc


# Internal sync implementation; the durable /voice/publish queue is the public entry point.
async def sync(company: Company = Depends(tenant), db: AsyncSession = Depends(get_db)):
    if not get_settings().web_voice_enabled:
        raise HTTPException(403, 'Enable WEB_VOICE_ENABLED to sync documents to ElevenLabs.')
    try:
        agent_id = company_agent_id(company.id)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    profile = await profile_for(company, db)
    docs = await documents_for(company.id, db)
    expected_checks = (await db.execute(select(SupportCheckSuite.cases).where(SupportCheckSuite.company_id == company.id))).scalar_one_or_none() or []
    # Reuse provider IDs on retries. The publishing worker owns the tenant lease.
    await db.execute(select(Company.id).where(Company.id == company.id).with_for_update())
    rows = (await db.execute(select(SupportVoiceDocument).where(SupportVoiceDocument.company_id == company.id))).scalars().all()
    if any(row.agent_id != agent_id for row in rows):
        raise HTTPException(409, 'Agent mapping changed. Remove old provider attachments before reassigning this company.')
    try:
        current_ids = {d.id for d in docs}
        obsolete = [row for row in rows if row.document_id not in current_ids]
        existing = {row.document_id: row for row in rows if row.document_id in current_ids}
        prepared = []
        for doc in docs:
            row = existing.get(doc.id)
            if not row:
                uploaded = await provider_request('POST', '/knowledge-base/text', json={'text': doc.content, 'name': f'{company.id}/{doc.name}'})
                row = SupportVoiceDocument(document_id=doc.id, company_id=company.id, agent_id=agent_id, provider_id=uploaded['id'])
                db.add(row)
                await db.commit()
            await ensure_indexed(row.provider_id, doc.content)
            prepared.append({'type': 'text', 'id': row.provider_id, 'name': doc.name, 'usage_mode': 'auto'})
        agent = await provider_request('GET', f'/agents/{agent_id}')
        from app.support.runtime_tools import publish_runtime_tool
        runtime_config, runtime_warning = await publish_runtime_tool(company, agent_id, agent, db)
        await db.execute(update(Company).where(Company.id == company.id).values(updated_at=Company.updated_at))
        # Recheck source IDs and settings before changing a live agent. Ingestion can
        # continue while indexing runs, but a changed workspace must be republished.
        from app.support.models import SupportProfile
        active = (await db.execute(select(Company.is_active).where(Company.id == company.id))).scalar_one()
        latest_ids = set((await db.execute(select(SupportDocument.id).where(SupportDocument.company_id == company.id))).scalars())
        saved_profile = (await db.execute(select(SupportProfile.configuration).where(SupportProfile.company_id == company.id))).scalar_one_or_none()
        latest_checks = (await db.execute(select(SupportCheckSuite.cases).where(SupportCheckSuite.company_id == company.id))).scalar_one_or_none() or []
        if latest_checks != expected_checks or company_agent_id(company.id) != agent_id or not active or latest_ids != current_ids or (saved_profile is not None and Profile.model_validate(saved_profile).model_dump() != profile.model_dump()):
            raise RuntimeError('Workspace changed during indexing. Publish again.')
        previous = agent.get('conversation_config', {}).get('agent', {}).get('prompt', {}).get('knowledge_base', [])
        managed = {row.provider_id for row in rows} | {item['id'] for item in prepared}
        retained = [item for item in previous if item.get('id') not in managed]
        # One final update attaches the fully indexed set, rather than exposing a
        # partially published document list over 35 individual updates.
        await provider_request('PATCH', f'/agents/{agent_id}', json={'conversation_config': {'agent': {
            'first_message': profile.greeting, 'prompt': {'prompt': voice_prompt(profile), 'timezone': profile.timezone, **runtime_config,
                'rag': {'enabled': True, 'embedding_model': get_settings().rag_embedding_model},
                'knowledge_base': retained + prepared}}}})
        for row in obsolete:
            await provider_request('DELETE', f'/knowledge-base/{row.provider_id}', allow_not_found=True)
            await db.delete(row)
        await db.commit()
        return {'synced': len(docs), 'agent_id': agent_id, 'caller_tools_ready': runtime_warning is None, 'warning': runtime_warning, 'message': 'Verified company knowledge and greeting published; native indexing completed for larger documents.'}

    except (RuntimeError, KeyError) as exc:
        raise HTTPException(502, 'ElevenLabs sync incomplete. Saved uploads will be reused on retry. Check provider configuration.') from exc


@router.get('/{company_id}/conversations')
async def conversations(company: Company = Depends(tenant), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(SupportConversation).where(SupportConversation.company_id == company.id).order_by(SupportConversation.created_at.desc()).limit(100))).scalars().all()
    from app.support.models import SupportCaller
    from app.support.callers import caller_json
    callers = (await db.execute(select(SupportCaller).where(SupportCaller.company_id == company.id, SupportCaller.conversation_id.in_([r.id for r in rows])))).scalars().all()
    details = {row.conversation_id: caller_json(row) for row in callers}
    return {'conversations': [{'caller': details.get(r.id), 'created_at': r.created_at.isoformat(), 'id': r.id, 'status': r.status, 'summary': r.summary, 'duration_seconds': r.duration_seconds, 'transcript': r.transcript, 'outcome': r.outcome} for r in rows]}


def verify_event(raw, signature, secret):
    if not secret:
        raise HTTPException(503, 'Webhook secret is not configured')
    try:
        parts = [part.strip().split('=', 1) for part in (signature or '').split(',')]
        timestamp = next(value for key, value in parts if key == 't')
        signatures = [value for key, value in parts if key == 'v0']
        if abs(time.time() - int(timestamp)) > 1800:
            raise ValueError('Expired')
        digest = hmac.new(secret.encode(), timestamp.encode() + b'.' + raw, hashlib.sha256).hexdigest()
        if not any(hmac.compare_digest(digest, value) for value in signatures):
            raise ValueError('Invalid')
        event = json.loads(raw)
        if not isinstance(event, dict):
            raise ValueError('Invalid event')
        return event
    except (ValueError, TypeError, StopIteration):
        raise HTTPException(401, 'Invalid webhook signature or payload')


@router.post('/webhooks/elevenlabs')
async def webhook(request: Request, db: AsyncSession = Depends(get_db)):
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 2 * 1024 * 1024:
            raise HTTPException(413, 'Webhook payload exceeds 2 MB. Disable audio webhooks.')
    event = verify_event(bytes(raw), request.headers.get('elevenlabs-signature'), get_settings().elevenlabs_webhook_secret)
    if event.get('type') not in ('post_call_transcription', 'call_initiation_failure'):
        return {'received': True, 'ignored': True}
    data = event.get('data')
    if not isinstance(data, dict) or not isinstance(data.get('conversation_id'), str) or not 1 <= len(data['conversation_id']) <= 120:
        raise HTTPException(422, 'Conversation ID is required')
    # Trust the signed provider agent ID, never caller-supplied company dynamic variables.
    mapped = [key for key, value in get_settings().elevenlabs_company_agents.items() if value == data.get('agent_id')]
    if len(mapped) != 1:
        raise HTTPException(409, 'Agent must map to exactly one company')
    try:
        company_id = UUID(mapped[0])
        company_agent_id(company_id)
    except ValueError as exc:
        raise HTTPException(409, 'Invalid company agent mapping') from exc
    company = await db.get(Company, company_id)
    if not company or not company.is_active:
        raise HTTPException(404, 'Active company not found')
    existing = await db.get(SupportConversation, data['conversation_id'])
    if existing:
        return {'received': True, 'duplicate': True}
    analysis = data.get('analysis') or {}
    metadata = data.get('metadata') or {}
    if not isinstance(analysis, dict) or not isinstance(metadata, dict) or not isinstance(data.get('transcript', []), list):
        raise HTTPException(422, 'Invalid conversation data')
    db.add(SupportConversation(id=data['conversation_id'][:120], company_id=company_id,
        status=str(data.get('status') or 'failed')[:50], transcript=data.get('transcript', []),
        summary=str(analysis.get('transcript_summary') or data.get('failure_reason') or '')[:10000],
        duration_seconds=metadata.get('call_duration_secs') if isinstance(metadata.get('call_duration_secs'), int) else None,
        outcome=str(analysis.get('call_successful') or 'unknown')[:50]))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        if not await db.get(SupportConversation, data['conversation_id']):
            raise
    return {'received': True}
