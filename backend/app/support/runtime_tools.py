"""Publish one narrowly scoped server tool; credentials never enter the prompt."""
import asyncio
import secrets
import bcrypt
from urllib.parse import urlsplit
from fastapi import HTTPException
from app.config.settings import get_settings
from app.models.models import ApiKey
from app.support.models import SupportRuntimeTool
from app.utils.elevenlabs_client import provider_request


def tool_schema(company_id, secret_id):
    text = lambda description: {'type': 'string', 'description': description}
    return {'type': 'webhook', 'name': 'support_call',
        'description': 'Check current human availability; save consented caller details; request human support or a callback. Send a complete snapshot each time. Never invent contacts or consent.',
        'response_timeout_secs': 30, 'api_schema': {
            'url': f'{get_settings().api_base_url.rstrip("/")}/api/support/{company_id}/caller-context',
            'method': 'POST', 'request_headers': {'Authorization': {'secret_id': secret_id}},
            'request_body_schema': {'type': 'object', 'required': ['action', 'conversation_id', 'consent'], 'properties': {
                'action': {**text('Use availability, capture, or handoff.'), 'enum': ['availability', 'capture', 'handoff']},
                'conversation_id': {'type': 'string', 'dynamic_variable': 'system__conversation_id'},
                'name': text('Confirmed preferred name. Empty if declined or no consent.'),
                'phone': text('Confirmed callback number with country code. Empty if not provided or no consent.'),
                'email': text('Confirmed email. Omit if not provided or no consent.'),
                'reason': text('Concise reason for calling; exclude secrets and unnecessary personal data.'),
                'consent': {'type': 'boolean', 'description': 'True only if caller explicitly allowed saving contact details.'},
                'callback_requested': {'type': 'boolean', 'description': 'True only if caller agreed to a callback request.'},
                'callback_preference': text('Caller preferred callback window; not a booking.')
            }}}}


async def publish_runtime_tool(company, agent_id, agent, db):
    # Public HTTPS is required for provider-to-server calls. Local demos remain usable.
    parsed = urlsplit(get_settings().api_base_url)
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise HTTPException(409, 'API_BASE_URL must not contain credentials, a query or fragment')
    if parsed.scheme != 'https' or not parsed.hostname or parsed.hostname in ('localhost', '127.0.0.1', '::1'):
        return {}, 'Caller tools need a publicly reachable HTTPS API_BASE_URL before phone activation.'
    row = await db.get(SupportRuntimeTool, company.id)
    if row and row.agent_id != agent_id:
        raise HTTPException(409, 'Runtime tool belongs to a different agent; revoke it before remapping this company.')
    if not row:
        raw = secrets.token_urlsafe(32)
        key = ApiKey(company_id=company.id, key_hash=(await asyncio.to_thread(bcrypt.hashpw, raw.encode(), bcrypt.gensalt())).decode(),
            name='Voice caller intake only', permissions=['voice_tools'])
        db.add(key)
        await db.flush()
        secret = await provider_request('POST', '/secrets', json={'type': 'new', 'name': f'support-caller-{company.id}', 'value': f'Bearer {raw}'})
        row = SupportRuntimeTool(company_id=company.id, agent_id=agent_id, secret_id=secret['secret_id'], api_key_id=key.id)
        db.add(row)
        await db.commit()  # Reuse key/secret on a retry; raw key is never persisted.
    key = await db.get(ApiKey, row.api_key_id)
    if not key or not key.is_active:
        raise HTTPException(409, 'Caller tool credential was revoked. Reconfigure it before publishing.')
    config = tool_schema(company.id, row.secret_id)
    if row.tool_id:
        await provider_request('PATCH', f'/tools/{row.tool_id}', json={'tool_config': config})
    else:
        result = await provider_request('POST', '/tools', json={'tool_config': config})
        row.tool_id = result['id']
        await db.commit()
    previous = agent.get('conversation_config', {}).get('agent', {}).get('prompt', {})
    # Keep unrelated tools. Refuse a name collision rather than silently replacing it.
    for item in previous.get('tools', []):
        if item.get('name') == 'support_call':
            raise HTTPException(409, 'Remove the legacy inline support_call tool before publishing the managed tool.')
    ids = list(dict.fromkeys([*previous.get('tool_ids', []), row.tool_id]))
    built_in = dict(previous.get('built_in_tools') or {})
    # Dedicated company agent: this slot is managed by the company human-phone setting.
    built_in['transfer_to_number'] = None
    from app.support.api import profile_for
    profile = await profile_for(company, db)
    if profile.human_phone:
        built_in['transfer_to_number'] = {'type': 'system', 'name': 'transfer_to_number',
            'description': 'Transfer only after support_call returns transfer_available for an explicit human request. On failure, offer a callback request.',
            'params': {'system_tool_type': 'transfer_to_number', 'transfers': [{
                'transfer_destination': {'type': 'phone', 'phone_number': profile.human_phone},
                'condition': 'Caller explicitly requests a human and support_call has just returned transfer_available. Never transfer after hours or during a browser conversation.',
                'transfer_type': 'conference'}]}}
    return {'tool_ids': ids, 'built_in_tools': built_in}, None
