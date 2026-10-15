"""Additive support tables; existing company databases remain compatible."""
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Text, JSON, DateTime, ForeignKey, UniqueConstraint, Integer
from sqlalchemy.dialects.postgresql import UUID
from app.config.database import Base


def now():
    return datetime.now(timezone.utc)


class SupportProfile(Base):
    __tablename__ = 'support_profiles'
    company_id = Column(UUID(as_uuid=True), ForeignKey('companies.id'), primary_key=True)
    configuration = Column(JSON, nullable=False)


class SupportDocument(Base):
    __tablename__ = 'support_documents'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey('companies.id'), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=now)


class SupportTicket(Base):
    __tablename__ = 'support_tickets'
    __table_args__ = (UniqueConstraint('company_id', 'idempotency_key'),)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey('companies.id'), nullable=False, index=True)
    idempotency_key = Column(String(100), nullable=False)
    subject = Column(String(160), nullable=False)
    summary = Column(Text, nullable=False)
    customer_email = Column(String(255))
    customer_phone = Column(String(30))
    transcript = Column(Text)
    priority = Column(String(20), default='normal')
    team = Column(String(80), nullable=False)
    recipient = Column(String(255), nullable=False)
    status = Column(String(20), default='open')
    delivery_status = Column(String(30), default='pending')
    delivery_error = Column(String(255))
    delivery_started_at = Column(DateTime(timezone=True))
    attempts = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), default=now)


class SupportVoiceDocument(Base):
    __tablename__ = 'support_voice_documents'
    document_id = Column(UUID(as_uuid=True), primary_key=True)
    company_id = Column(UUID(as_uuid=True), ForeignKey('companies.id'), nullable=False, index=True)
    agent_id = Column(String(120), nullable=False)
    provider_id = Column(String(120), nullable=False)


class SupportConversation(Base):
    __tablename__ = 'support_conversations'
    id = Column(String(120), primary_key=True)
    company_id = Column(UUID(as_uuid=True), ForeignKey('companies.id'), nullable=False, index=True)
    status = Column(String(50), nullable=False)
    transcript = Column(JSON, default=list)
    summary = Column(Text)
    duration_seconds = Column(Integer)
    outcome = Column(String(50))
    created_at = Column(DateTime(timezone=True), default=now)
