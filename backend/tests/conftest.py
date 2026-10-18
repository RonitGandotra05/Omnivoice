"""
Pytest configuration and shared fixtures for the backend test suite.
"""

import os
import pytest
from httpx import AsyncClient, ASGITransport

# Override env vars before importing the app so Settings uses test values.
os.environ["RATE_LIMIT_ENABLED"] = "false"
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///test.db")

from app.main import app  # noqa: E402


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    """Async HTTP client wired to the FastAPI app (no real server needed)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
