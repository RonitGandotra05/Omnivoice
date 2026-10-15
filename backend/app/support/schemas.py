"""Validated, portable company support configuration."""
from typing import Literal
from pydantic import BaseModel, Field, EmailStr, field_validator


class Route(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    keywords: list[str] = Field(default_factory=list, max_length=30)


class Profile(BaseModel):
    company_name: str = Field(min_length=2, max_length=120)
    greeting: str = Field(default="Hello, I'm your AI support assistant. How can I help?", max_length=500)
    instructions: str = Field(default="Warm, clear, and concise. Ask one question at a time.", max_length=2000)
    support_email: EmailStr = "support@example.com"
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
    documents: list[Document] = Field(default_factory=list, max_length=30)

    @field_validator('documents')
    @classmethod
    def total_size(cls, docs):
        if sum(len(d.content) for d in docs) > 500000:
            raise ValueError('Combined documents exceed 500,000 characters')
        return docs


class Escalation(BaseModel):
    @field_validator('subject')
    @classmethod
    def safe_subject(cls, value):
        if any(ord(c) < 32 for c in value):
            raise ValueError('Subject must be a single line')
        return value.strip()

    subject: str = Field(min_length=3, max_length=160)
    summary: str = Field(min_length=10, max_length=4000)
    customer_email: EmailStr | None = None
    customer_phone: str = Field(default="", max_length=30)
    transcript: str = Field(default="", max_length=20000)
    priority: Literal['normal', 'high'] = 'normal'
    idempotency_key: str = Field(min_length=8, max_length=100, pattern=r'^[a-zA-Z0-9_-]+$')
