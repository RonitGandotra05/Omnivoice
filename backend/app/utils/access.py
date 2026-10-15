"""Operator-only access for operations that affect provider resources or stored data."""
import secrets
from fastapi import Header, HTTPException
from app.config.settings import get_settings


def require_operator(authorization: str | None = Header(None)):
    key = get_settings().integration_api_key
    if not key:
        raise HTTPException(503, "Set INTEGRATION_API_KEY to enable operator APIs.")
    supplied = (authorization or "").removeprefix("Bearer ")
    if not secrets.compare_digest(supplied, key):
        raise HTTPException(401, "Operator authorization required.")
