"""Database-shared request quotas and bounded ASGI bodies (SQLite/PostgreSQL)."""
import asyncio
import hashlib
import math
import time
from sqlalchemy import Column, String, Integer, Index, delete
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from starlette.responses import JSONResponse
from app.config.database import Base, async_session
from app.config.settings import get_settings


class RequestQuota(Base):
    __tablename__ = 'request_quotas'
    key = Column(String(64), primary_key=True)
    window = Column(Integer, primary_key=True)
    count = Column(Integer, nullable=False, default=0)
    __table_args__ = (Index('ix_request_quotas_window', 'window'),)


rate_sessions = async_session


async def consume_quota(identity, scope, limit, period=60, sessions=None, now=None):
    """Atomic fixed windows, shared by all processes using this database."""
    current = time.time() if now is None else now
    window = int(current // period)
    key = hashlib.sha256(f'{scope}:{identity}'.encode()).hexdigest()
    async with (sessions or rate_sessions)() as db:
        dialect = db.bind.dialect.name
        insert = postgres_insert if dialect == 'postgresql' else sqlite_insert
        stmt = insert(RequestQuota).values(key=key, window=window, count=1)
        stmt = stmt.on_conflict_do_update(index_elements=['key', 'window'],
            set_={'count': RequestQuota.count + 1}, where=RequestQuota.count < limit).returning(RequestQuota.count)
        count = (await db.execute(stmt)).scalar_one_or_none()
        # Bound quota-table growth; time buckets contain only hashes, never credentials/IPs.
        await db.execute(delete(RequestQuota).where(RequestQuota.window < window - 2))
        await db.commit()
    return count is not None, max(1, math.ceil((window + 1) * period - current))


class RequestProtection:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or not scope['path'].startswith('/api/'):
            return await self.app(scope, receive, send)
        settings = get_settings()
        headers = {k.lower(): v.decode('latin1') for k, v in scope['headers']}
        if settings.rate_limit_enabled:
            ip = (scope.get('client') or ('unknown', 0))[0]
            credential = headers.get(b'authorization', '')
            limits = [('ip', ip, settings.ip_requests_per_minute)]
            path = scope['path']
            if '/auth/' in path:
                limits.append(('auth', ip, 15))
            elif path.endswith(('/parse', '/documents')) and scope['method'] == 'POST':
                limits.append(('upload', credential or ip, settings.uploads_per_minute))
            elif path.endswith('/checks/run') and scope['method'] == 'POST':
                limits.append(('checks', credential or ip, 6))
            elif '/voice/' in path and scope['method'] != 'GET':
                limits.append(('voice', credential or ip, 15))
            elif '/escalations' in path and scope['method'] == 'POST':
                limits.append(('escalation', credential or ip, 30))
            else:
                limits.append(('api', credential or ip, settings.api_requests_per_minute))
            try:
                for name, identity, limit in limits:
                    allowed, retry = await consume_quota(identity, name, limit)
                    if not allowed:
                        return await JSONResponse({'detail': 'Too many requests. Please retry shortly.'}, 429,
                            headers={'Retry-After': str(retry), 'Cache-Control': 'no-store'})(scope, receive, send)
            except Exception:
                return await JSONResponse({'detail': 'Request protection is temporarily unavailable.'}, 503)(scope, receive, send)
        maximum = settings.max_request_bytes
        try:
            length = int(headers.get(b'content-length', '0'))
        except ValueError:
            return await JSONResponse({'detail': 'Invalid content length.'}, 400)(scope, receive, send)
        if length < 0 or length > maximum:
            return await JSONResponse({'detail': 'Request exceeds the size limit.'}, 413)(scope, receive, send)
        # Bound streamed/chunked bodies as well as Content-Length before multipart parsing.
        body = bytearray()
        try:
            async with asyncio.timeout(settings.request_body_timeout_seconds):
                while True:
                    message = await receive()
                    if message['type'] == 'http.disconnect':
                        return
                    body.extend(message.get('body', b''))
                    if len(body) > maximum:
                        return await JSONResponse({'detail': 'Request exceeds the size limit.'}, 413)(scope, receive, send)
                    if not message.get('more_body', False):
                        break
        except TimeoutError:
            return await JSONResponse({'detail': 'Upload timed out. Please retry.'}, 408)(scope, receive, send)
        delivered = False
        async def bounded_receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {'type': 'http.request', 'body': bytes(body), 'more_body': False}
            return await receive()
        await self.app(scope, bounded_receive, send)
