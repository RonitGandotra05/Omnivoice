"""Additive support tables; existing company databases remain compatible."""
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Text, JSON, DateTime, ForeignKey, UniqueConstraint, Integer
from sqlalchemy.dialects.postgresql import UUID
from app.config.database import Base
from app.security.encryption import SecureText, SecureJSON


def now():
    return datetime.now(timezone.utc)


class SupportProfile(Base):
    __tablename__ = 'support_profiles'
    company_id = Column(UUID(as_uuid=True), ForeignKey('companies.id'), primary_key=True)
    configuration = Column(SecureJSON('SupportProfile.configuration'), nullable=False)


class SupportDocument(Base):
    __tablename__ = 'support_documents'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey('companies.id'), nullable=False, index=True)
    name = Column(SecureText('SupportDocument.name'), nullable=False)
    content = Column(SecureText('SupportDocument.content'), nullable=False)
    created_at = Column(DateTime(timezone=True), default=now)


class SupportTicket(Base):
    __tablename__ = 'support_tickets'
    __table_args__ = (UniqueConstraint('company_id', 'idempotency_key'),)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey('companies.id'), nullable=False, index=True)
    idempotency_key = Column(String(100), nullable=False)
    subject = Column(SecureText('SupportTicket.subject'), nullable=False)
    summary = Column(SecureText('SupportTicket.summary'), nullable=False)
    customer_email = Column(SecureText('SupportTicket.customer_email'))
    customer_phone = Column(SecureText('SupportTicket.customer_phone'))
    transcript = Column(SecureText('SupportTicket.transcript'))
    priority = Column(String(20), default='normal')
    team = Column(SecureText('SupportTicket.team'), nullable=False)
    recipient = Column(SecureText('SupportTicket.recipient'), nullable=False)
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
    transcript = Column(SecureJSON('SupportConversation.transcript'), default=list)
    summary = Column(SecureText('SupportConversation.summary'))
    duration_seconds = Column(Integer)
    outcome = Column(String(50))
    created_at = Column(DateTime(timezone=True), default=now)


class SupportDocumentDetails(Base):
    __tablename__ = 'support_document_details'
    __table_args__ = (UniqueConstraint('company_id', 'fingerprint'),)
    document_id = Column(UUID(as_uuid=True), ForeignKey('support_documents.id', ondelete='CASCADE'), primary_key=True)
    company_id = Column(UUID(as_uuid=True), ForeignKey('companies.id'), nullable=False, index=True)
    fingerprint = Column(String(64), nullable=False)
    quality = Column(JSON, nullable=False, default=dict)


class SupportDocumentReview(Base):
    __tablename__ = 'support_document_reviews'
    __table_args__ = (UniqueConstraint('company_id', 'fingerprint'),)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey('companies.id'), nullable=False, index=True)
    fingerprint = Column(String(64), nullable=False)
    name = Column(SecureText('SupportDocumentReview.name'), nullable=False)
    content = Column(SecureText('SupportDocumentReview.content'), nullable=False)
    quality = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), default=now)


class SupportPublishJob(Base):
    __tablename__ = 'support_publish_jobs'
    company_id = Column(UUID(as_uuid=True), ForeignKey('companies.id'), primary_key=True)
    job_id = Column(UUID(as_uuid=True), default=uuid.uuid4, nullable=False)
    status = Column(String(30), nullable=False, default='queued', index=True)
    owner = Column(String(64))
    lease_until = Column(DateTime(timezone=True))
    result = Column(JSON, default=dict)
    error = Column(String(300))
    updated_at = Column(DateTime(timezone=True), default=now)


class SupportCheckSuite(Base):
    __tablename__ = 'support_check_suites'
    company_id = Column(UUID(as_uuid=True), ForeignKey('companies.id'), primary_key=True)
    cases = Column(SecureJSON('SupportCheckSuite.cases'), nullable=False, default=list)
    last_report = Column(SecureJSON('SupportCheckSuite.last_report'), nullable=False, default=dict)


class SupportRelease(Base):
    __tablename__ = 'support_releases'
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey('companies.id'), nullable=False, index=True)
    revision = Column(String(64), nullable=False)
    document_count = Column(Integer, nullable=False)
    checks_passed = Column(Integer, nullable=False, default=0)
    checks_total = Column(Integer, nullable=False, default=0)
    published_at = Column(DateTime(timezone=True), default=now, nullable=False)


class SupportCaller(Base):
    __tablename__ = 'support_callers'
    __table_args__ = (UniqueConstraint('company_id', 'conversation_id'),)
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey('companies.id'), nullable=False, index=True)
    conversation_id = Column(String(120), nullable=False)
    details = Column(SecureJSON('SupportCaller.details'), nullable=False, default=dict)
    ticket_id = Column(UUID(as_uuid=True), ForeignKey('support_tickets.id'))
    created_at = Column(DateTime(timezone=True), default=now)
    updated_at = Column(DateTime(timezone=True), default=now)


class SupportRuntimeTool(Base):
    __tablename__ = 'support_runtime_tools'
    company_id = Column(UUID(as_uuid=True), ForeignKey('companies.id'), primary_key=True)
    agent_id = Column(String(120), nullable=False)
    tool_id = Column(String(120))
    secret_id = Column(String(120), nullable=False)
    api_key_id = Column(UUID(as_uuid=True), ForeignKey('api_keys.id'), nullable=False)
