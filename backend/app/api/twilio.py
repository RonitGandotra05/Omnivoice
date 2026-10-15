"""Retired local bridge. Native Twilio integration owns the phone media stream."""
from fastapi import APIRouter, HTTPException
router = APIRouter()

@router.post('/outbound-answer')
async def retired_bridge():
    raise HTTPException(410, 'Import and assign the phone number in ElevenLabs. The local Twilio media bridge is retired.')
