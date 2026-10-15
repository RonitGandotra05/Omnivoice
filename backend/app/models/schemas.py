"""
Pydantic schemas for request/response validation.
"""

import re
from enum import Enum
from pydantic import BaseModel, Field, field_validator, EmailStr
from typing import Optional
from datetime import datetime
from uuid import UUID


# ── Reusable validators ──────────────────────────────────────────────

_PHONE_RE = re.compile(r"^\+?[1-9]\d{6,14}$")
_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def _validate_phone(v: str | None) -> str | None:
    if v is not None and not _PHONE_RE.match(v):
        raise ValueError("Phone number must be in E.164 format, e.g. +14155551234")
    return v


# ---- Auth Schemas ----

class SSOLoginRequest(BaseModel):
    email: EmailStr
    name: Optional[str] = None
    provider: str  # 'google', 'apple', 'linkedin'
    sso_id: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: UUID


# ---- Company Schemas ----

class ServiceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    pricing: Optional[str] = None
    duration_minutes: Optional[int] = Field(None, ge=1, le=1440)
    is_bookable: bool = True


class ServiceResponse(ServiceCreate):
    id: UUID
    is_active: bool = True

    class Config:
        from_attributes = True


class CompanyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    slug: str = Field(..., min_length=2, max_length=100)
    phone_number: Optional[str] = None
    greeting: Optional[str] = "Hello, thank you for calling. How may I assist you today?"
    fallback_message: Optional[str] = None
    timezone: Optional[str] = "UTC"
    business_hours: Optional[dict] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    services: Optional[list[ServiceCreate]] = []

    @field_validator("slug")
    @classmethod
    def validate_slug(cls, v: str) -> str:
        v = v.lower().strip()
        if not _SLUG_RE.match(v):
            raise ValueError("Slug must contain only lowercase letters, numbers, and hyphens")
        return v

    @field_validator("phone_number", "contact_phone")
    @classmethod
    def validate_phone(cls, v: str | None) -> str | None:
        return _validate_phone(v)


class CompanyUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    phone_number: Optional[str] = None
    greeting: Optional[str] = None
    fallback_message: Optional[str] = None
    timezone: Optional[str] = None
    business_hours: Optional[dict] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    is_active: Optional[bool] = None

    @field_validator("phone_number", "contact_phone")
    @classmethod
    def validate_phone(cls, v: str | None) -> str | None:
        return _validate_phone(v)


class CompanyResponse(BaseModel):
    id: UUID
    name: str
    slug: str
    phone_number: Optional[str]
    greeting: Optional[str]
    fallback_message: Optional[str]
    timezone: str
    business_hours: Optional[dict]
    contact_email: Optional[str]
    contact_phone: Optional[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime
    services: list[ServiceResponse] = []

    class Config:
        from_attributes = True


class CompanyListItem(BaseModel):
    id: UUID
    name: str
    slug: str
    phone_number: Optional[str]
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ---- Knowledge Document Schemas ----

class DocumentResponse(BaseModel):
    id: UUID
    filename: str
    original_name: Optional[str]
    content_type: str
    file_size: Optional[int]
    chunk_count: int
    status: str
    error_message: Optional[str]
    uploaded_at: datetime
    indexed_at: Optional[datetime]

    class Config:
        from_attributes = True


# ---- Interaction Schemas ----

class InteractionResponse(BaseModel):
    id: UUID
    company_id: UUID
    type: str
    status: str
    customer_name: Optional[str]
    customer_phone: str
    data: Optional[dict]
    summary: Optional[str]
    sentiment: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ---- Agent Schemas ----

class QueryRequest(BaseModel):
    """Request to process a customer query."""
    query: str = Field(..., min_length=1, max_length=2000)
    twilio_number: str
    customer_phone: str
    conversation_history: list[dict] = []
    action_data: dict = {}

    @field_validator("twilio_number", "customer_phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        if not _PHONE_RE.match(v):
            raise ValueError("Phone number must be in E.164 format, e.g. +14155551234")
        return v


class QueryResponse(BaseModel):
    """Response from the agent orchestrator."""
    response: str
    refined_query: Optional[str] = None
    intent: str
    action_type: Optional[str] = None
    action_data: dict = {}
    is_action_complete: bool = False
    interaction_id: Optional[str] = None
    company_name: Optional[str] = None
    errors: list[str] = []


class TrialAgentType(str, Enum):
    customer_support = "customer_support"
    booking = "booking"
    feedback = "feedback"
    calling = "calling"


class TryForFreeRequest(BaseModel):
    """Request to initiate an outbound demo call."""
    company_name: str = Field(..., min_length=2, max_length=255)
    agent_type: TrialAgentType
    phone_number: str = Field(..., description="E.164 phone number to call")
    company_context: str = Field(..., min_length=20, max_length=8000)
    special_instructions: Optional[str] = Field(None, max_length=4000)

    @field_validator("company_name")
    @classmethod
    def validate_company_name(cls, v: str) -> str:
        value = v.strip()
        if len(value) < 2:
            raise ValueError("Company name must be at least 2 characters")
        return value

    @field_validator("phone_number")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        if not _PHONE_RE.match(v):
            raise ValueError("Phone number must be in E.164 format, e.g. +14155551234")
        return v


# ---- Pagination ----

class PaginatedResponse(BaseModel):
    page: int = Field(..., ge=1)
    limit: int = Field(..., ge=1, le=100)
    total: int = Field(..., ge=0)
    pages: int = Field(..., ge=0)


class SimulationRequest(BaseModel):
    company_name: str = Field(..., min_length=2, max_length=120)
    agent_type: TrialAgentType = TrialAgentType.customer_support
    company_context: str = Field(..., min_length=20, max_length=8000)
    special_instructions: str = Field("", max_length=2000)
    scenario: str = Field("hours", pattern="^(hours|booking|feedback|unknown|off_topic)$")

    @field_validator("company_name", "company_context")
    @classmethod
    def reject_blank(cls, value: str) -> str:
        if len(value.strip()) < 2:
            raise ValueError("Must contain text")
        return value.strip()
