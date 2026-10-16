"""
Inbound Calling Agent - FastAPI Backend
"""

import logging
import asyncio
from contextlib import suppress
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.config.settings import get_settings
from app.config.logging_config import setup_logging


# Configure logging before anything else
setup_logging()
logger = logging.getLogger(__name__)

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifecycle."""
    logger.info("Starting %s v%s", settings.app_name, "2.0.0")
    
    if settings.production_mode:
        if settings.debug:
            raise RuntimeError("DEBUG must be disabled in production.")
        if len(settings.jwt_secret) < 32 or any(marker in settings.jwt_secret.lower() for marker in ('change-me', 'replace-with', 'example', 'dummy')):
            raise RuntimeError('Production requires a strong JWT_SECRET.')
        if len(settings.integration_api_key) < 32 or any(marker in settings.integration_api_key.lower() for marker in ('change-me', 'replace-with', 'example', 'dummy')):
            raise RuntimeError('Production requires a strong INTEGRATION_API_KEY.')
        if not settings.database_url.startswith(('postgres://', 'postgresql')):
            raise RuntimeError('Production requires PostgreSQL for concurrent tenant writes.')
        if not settings.rate_limit_enabled or settings.public_demo_enabled:
            raise RuntimeError('Enable request limits and disable public demo in production.')

    if settings.production_mode:
        from urllib.parse import urlsplit
        if urlsplit(settings.frontend_url).scheme != 'https':
            raise RuntimeError('Production FRONTEND_URL must use HTTPS.')
        from app.security.encryption import keyring
        if not settings.data_encryption_active_key or not keyring() or settings.allow_legacy_plaintext_reads:
            raise RuntimeError('Production requires a data encryption keyring and legacy plaintext reads disabled.')
        if not settings.malware_scan_enabled:
            raise RuntimeError('Production requires malware scanning.')
        from app.security.sandbox import command
        command('txt', required=True)
        # Exercise the real scanner and namespace permissions before serving traffic.
        from app.utils.parse_async import parse_isolated
        try:
            await parse_isolated(b'OmniVoice security startup check.', 'txt')
        except Exception as exc:
            raise RuntimeError('Production document scanner/sandbox preflight failed; uploads are disabled.') from exc

    if settings.production_mode and settings.ocr_enabled:
        from app.utils.ocr import availability
        if not await asyncio.to_thread(availability, settings.ocr_languages):
            raise RuntimeError('OCR requires Tesseract and all configured language/OSD packs.')

    # Initialize DB (Useful for creating the local SQLite file automatically)
    from app.config.database import engine, Base
    from app.models import models # Ensure models are imported
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        logger.info("Database schema initialized")
        
    from app.support.publishing import worker
    publish_worker = asyncio.create_task(worker())
    app.state.publish_worker = publish_worker
    try:
        yield
    finally:
        publish_worker.cancel()
        with suppress(asyncio.CancelledError):
            await publish_worker
    logger.info("Shutting down %s", settings.app_name)


app = FastAPI(
    title=settings.app_name,
    version="2.0.0",
    description="Multi-tenant AI-powered inbound calling agent platform",
    lifespan=lifespan,
)


# ── Global exception handlers ────────────────────────────────────────


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    """Return a clean JSON response for malformed requests."""
    errors = []
    for err in exc.errors():
        field = " → ".join(str(loc) for loc in err["loc"])
        errors.append(f"{field}: {err['msg']}")
    logger.warning("Validation error on %s %s: %s", request.method, request.url.path, errors)
    return JSONResponse(
        status_code=422,
        content={"error": "Validation error", "detail": errors},
    )


@app.exception_handler(Exception)
async def global_error_handler(request: Request, exc: Exception):
    """Catch-all handler so unhandled errors return JSON, not HTML tracebacks."""
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    detail = str(exc) if settings.debug else "An internal error occurred."
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "detail": detail},
    )


# ── CORS middleware ──────────────────────────────────────────────────

from app.config.protection import RequestProtection
app.add_middleware(RequestProtection)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url] if settings.production_mode else [
        settings.frontend_url, "http://127.0.0.1:3000", "http://localhost:3000", "http://localhost:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["Content-Type", "Authorization"],
)


import time as _time

_STARTED_AT = _time.monotonic()


@app.get("/health")
async def health(detailed: bool = False):
    """Health check endpoint.

    Returns basic status by default.
    Pass ?detailed=true for database and service connectivity checks.
    """
    uptime_seconds = round(_time.monotonic() - _STARTED_AT)

    result = {
        "status": "healthy",
        "service": settings.app_name,
        "version": "2.0.0",
        "uptime_seconds": uptime_seconds,
    }

    if detailed:
        # Check database connectivity
        try:
            from app.config.database import async_session
            from sqlalchemy import text

            async with async_session() as session:
                await session.execute(text("SELECT 1"))
            result["database"] = "connected"
        except Exception as db_err:
            result["database"] = "unavailable"
            result["status"] = "degraded"

    return result


# Register API routers
from app.api import companies, knowledge, agent, twilio, auth

app.include_router(companies.router, prefix="/api/companies", tags=["companies"])
app.include_router(knowledge.router, prefix="/api/knowledge", tags=["knowledge"])
app.include_router(agent.router, prefix="/api/agent", tags=["agent"])
app.include_router(twilio.router, prefix="/api/twilio", tags=["twilio"])
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])


from app.support.api import router as support_router
app.include_router(support_router, prefix="/api/support", tags=["support"])
from app.support.voice import router as voice_router
app.include_router(voice_router, prefix="/api/support", tags=["voice"])

from app.support.checks import router as checks_router
app.include_router(checks_router, prefix="/api/support", tags=["knowledge checks"])

from app.support.publishing import router as publish_router
app.include_router(publish_router, prefix="/api/support", tags=["publishing"])


@app.get('/ready')
async def ready():
    from app.config.database import async_session
    from sqlalchemy import text
    try:
        async with async_session() as db:
            await db.execute(text('SELECT 1'))
        queue_worker = getattr(app.state, 'publish_worker', None)
        if queue_worker is None or queue_worker.done():
            raise RuntimeError('Worker not available')
        return {'status': 'ready'}
    except Exception:
        return JSONResponse({'status': 'not_ready'}, status_code=503)

from app.support.callers import router as callers_router
app.include_router(callers_router, prefix="/api/support", tags=["caller support"])
