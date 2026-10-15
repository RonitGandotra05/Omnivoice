"""Voice agent configuration, offline preview, and explicitly enabled operator calls."""
import logging
import re
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.config.database import get_db
from app.config.settings import get_settings
from app.models.models import Company, TrialSession
from app.models.schemas import QueryRequest, TryForFreeRequest, SimulationRequest
from app.utils.elevenlabs_client import initiate_trial_call
from app.utils.simulation import simulate
from app.utils.access import require_operator

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get('/status')
async def status():
    settings = get_settings()
    return {"provider": "ElevenLabs Agents", "configured": bool(settings.elevenlabs_api_key and settings.elevenlabs_agent_id),
        "phone_configured": bool(settings.elevenlabs_phone_number_id),
        "live_calls_enabled": settings.live_calls_enabled,
        "simulation_available": True, "inbound": "Use ElevenLabs native Twilio integration"}


@router.post('/simulate')
async def simulation(body: SimulationRequest):
    return simulate(body)


@router.post('/process', status_code=410)
async def process(body: QueryRequest):
    raise HTTPException(410, 'Local text orchestration was retired. Use /api/agent/simulate for offline previews or ElevenLabs for voice.')


@router.get('/greeting', dependencies=[Depends(require_operator)])
async def greeting(twilio_number: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Company).where(Company.phone_number == twilio_number))
    company = result.scalar_one_or_none()
    return {"greeting": company.greeting if company and company.greeting else 'Hello, how can I help today?'}


@router.post('/try-for-free', dependencies=[Depends(require_operator)])
async def trial(body: TryForFreeRequest, db: AsyncSession = Depends(get_db)):
    settings = get_settings()
    if not settings.live_calls_enabled:
        raise HTTPException(403, 'Live calls are disabled. Use the offline simulator.')
    if not re.fullmatch(r'\+[1-9]\d{6,14}', body.phone_number):
        raise HTTPException(422, 'A live call requires an E.164 phone number beginning with +.')
    if not (settings.elevenlabs_api_key and settings.elevenlabs_agent_id and settings.elevenlabs_phone_number_id):
        raise HTTPException(503, 'Configure ElevenLabs credentials, agent and imported phone number first.')
    session = TrialSession(id=uuid.uuid4(), company_name=body.company_name, agent_type=body.agent_type.value,
        phone_number=body.phone_number, company_context=body.company_context,
        special_instructions=body.special_instructions, status='queued')
    db.add(session)
    await db.flush()
    try:
        result = await initiate_trial_call(**body.model_dump())
        if result.get('success') is False:
            raise RuntimeError('Provider declined the call.')
    except RuntimeError as exc:
        session.status = 'failed'
        session.response_payload = {"error": 'Provider call initiation failed'}
        await db.commit()
        raise HTTPException(502, str(exc)) from exc
    session.status = 'initiated'
    session.external_call_id = result.get('callSid') or result.get('call_id')
    session.external_conversation_id = result.get('conversation_id') or result.get('conversationId')
    session.response_payload = result
    await db.commit()
    return {"status": "initiated", "trial_session_id": str(session.id),
        "call_id": session.external_call_id, "conversation_id": session.external_conversation_id}
