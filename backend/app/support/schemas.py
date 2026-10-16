"""Validated, portable company support configuration."""
from typing import Literal
from pydantic import BaseModel, Field, EmailStr, field_validator, model_validator


class Route(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    keywords: list[str] = Field(default_factory=list, max_length=30)

    @field_validator('name')
    @classmethod
    def non_blank_name(cls, value):
        if not value.strip():
            raise ValueError('Team name must contain text')
        return value.strip()

    @field_validator('keywords')
    @classmethod
    def clean_keywords(cls, values):
        cleaned = list(dict.fromkeys(value.strip().casefold() for value in values if value.strip()))
        if any(len(value) > 80 for value in cleaned):
            raise ValueError('Each routing keyword must be 80 characters or fewer')
        return cleaned


class OfficeWindow(BaseModel):
    day: int = Field(ge=0, le=6)  # Monday = 0
    opens: str = Field(pattern=r'^([01][0-9]|2[0-3]):[0-5][0-9]$')
    closes: str = Field(pattern=r'^([01][0-9]|2[0-3]):[0-5][0-9]$')

    @model_validator(mode='after')
    def valid_window(self):
        if self.opens == self.closes:
            raise ValueError('Opening and closing times must differ')
        return self


class Profile(BaseModel):
    company_name: str = Field(min_length=2, max_length=120)
    greeting: str = Field(default="Hello, I'm your AI support assistant. How can I help?", max_length=500)
    instructions: str = Field(default="Warm, clear, and concise. Ask one question at a time.", max_length=2000)
    support_email: EmailStr = "support@example.com"
    timezone: str = 'UTC'
    hours_enabled: bool = False
    office_hours: list[OfficeWindow] = Field(default_factory=list, max_length=21)
    holidays: list[str] = Field(default_factory=list, max_length=60)
    human_phone: str = Field(default='', max_length=16, pattern=r'^(|\+[1-9][0-9]{7,14})$')

    @field_validator('timezone')
    @classmethod
    def valid_timezone(cls, value):
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError('Use a valid IANA timezone, such as Asia/Kolkata')
        return value

    @field_validator('holidays')
    @classmethod
    def valid_holidays(cls, values):
        from datetime import date
        for value in values:
            if date.fromisoformat(value).isoformat() != value:
                raise ValueError('Use YYYY-MM-DD holiday dates')
        return sorted(set(values))

    routes: list[Route] = Field(default_factory=list, max_length=20)

    @field_validator('company_name', 'greeting')
    @classmethod
    def not_blank(cls, value):
        if len(value.strip()) < 2:
            raise ValueError('Please provide text')
        return value.strip()


class Document(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=10, max_length=200000)

    @field_validator('name', 'content')
    @classmethod
    def readable_text(cls, value, info):
        minimum = 10 if info.field_name == 'content' else 1
        if len(value.strip()) < minimum:
            raise ValueError('Document must contain readable text')
        return value.strip()


class Question(BaseModel):
    query: str = Field(min_length=2, max_length=2000)

    @field_validator('query')
    @classmethod
    def not_blank(cls, value):
        if len(value.strip()) < 2:
            raise ValueError('Please provide a question')
        return value.strip()


class Preview(Question):
    profile: Profile
    documents: list[Document] = Field(default_factory=list, max_length=100)

    @field_validator('documents')
    @classmethod
    def total_size(cls, docs):
        if sum(len(d.content) for d in docs) > 5000000:
            raise ValueError('Combined documents exceed 5,000,000 characters')
        return docs


class Escalation(BaseModel):
    @field_validator('subject')
    @classmethod
    def safe_subject(cls, value):
        if any(ord(c) < 32 for c in value):
            raise ValueError('Subject must be a single line')
        if len(value.strip()) < 3:
            raise ValueError('Subject must contain at least 3 characters')
        return value.strip()

    @field_validator('summary')
    @classmethod
    def non_blank_summary(cls, value):
        if len(value.strip()) < 10:
            raise ValueError('Summary must contain at least 10 characters')
        return value.strip()

    subject: str = Field(min_length=3, max_length=160)
    summary: str = Field(min_length=10, max_length=4000)
    customer_email: EmailStr | None = None
    customer_phone: str = Field(default="", max_length=30)
    transcript: str = Field(default="", max_length=20000)
    priority: Literal['normal', 'high'] = 'normal'
    idempotency_key: str = Field(min_length=8, max_length=100, pattern=r'^[a-zA-Z0-9_-]+$')


class CallerUpdate(BaseModel):
    """Full contact snapshot; callers may decline identity collection."""
    action: Literal['capture', 'availability', 'handoff'] = 'capture'
    conversation_id: str = Field(min_length=1, max_length=120, pattern=r'^[a-zA-Z0-9_-]+$')
    name: str = Field(default='', max_length=120)
    phone: str = Field(default='', max_length=30, pattern=r'^[+0-9 ()-]*$')
    email: EmailStr | None = None
    reason: str = Field(default='', max_length=2000)
    consent: bool = False
    callback_requested: bool = False
    callback_preference: str = Field(default='', max_length=300)

    @field_validator('phone')
    @classmethod
    def international_phone(cls, value):
        import re
        value = re.sub(r'[ ()-]', '', value.strip())
        if value and not re.fullmatch(r'\+[1-9][0-9]{7,14}', value):
            raise ValueError('Confirm a callback number including + and the country code')
        return value

    @field_validator('name', 'reason', 'callback_preference')
    @classmethod
    def trim_caller_text(cls, value):
        return value.strip()

    @model_validator(mode='after')
    def contact_consent(self):
        if not self.consent and (self.name.strip() or self.phone.strip() or self.email):
            raise ValueError('Permission is required before saving caller contact details')
        return self
