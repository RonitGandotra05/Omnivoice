"""
Async database connection using SQLAlchemy + AsyncPG.
"""

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.config.settings import get_settings


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy models."""
    pass


def _get_async_url(url: str) -> str:
    """Convert standard postgres URL to async-compatible one."""
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if url.startswith("sqlite"):
        return url
    from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
    parts = urlsplit(url)
    query = [(key, value) for key, value in parse_qsl(parts.query) if key not in ('sslmode', 'channel_binding')]
    url = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))
    return url


settings = get_settings()
async_url = _get_async_url(settings.database_url)

is_sqlite = async_url.startswith("sqlite")

engine_kwargs = {
    "echo": settings.debug and not settings.production_mode,
    "hide_parameters": True,
}

if not is_sqlite:
    engine_kwargs.update({
        "pool_size": 10,
        "max_overflow": 20,
        "pool_pre_ping": True,
    })
    from urllib.parse import urlsplit
    import ssl
    hostname = urlsplit(async_url).hostname
    if settings.production_mode or hostname not in ('localhost', '127.0.0.1', '::1'):
        engine_kwargs["connect_args"] = {"ssl": ssl.create_default_context()}

engine = create_async_engine(async_url, **engine_kwargs)

async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)


async def get_db() -> AsyncSession:
    """Dependency for FastAPI endpoints."""
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
