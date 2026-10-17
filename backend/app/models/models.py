"""
SQLAlchemy models matching the multi-tenant database schema.
"""

import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Text, Boolean, Integer, DateTime, ForeignKey, JSON
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.config.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(255))
    sso_provider = Column(String(50))  # e.g., 'google', 'apple', 'linkedin'
    sso_id = Column(String(255))       # The unique remote ID from the provider
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    
    # Relationships
    companies = relationship("CompanyUser", back_populates="user", cascade="all, delete-orphan")


class CompanyUser(Base):
    __tablename__ = "company_users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    # Elevated membership is assigned manually in the database, never by signup.
    role = Column(String(50), default="user", server_default="user", nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="companies")
    company = relationship("Company", back_populates="users")


class Company(Base):
    __tablename__ = "companies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    slug = Column(String(100), unique=True, nullable=False)
    phone_number = Column(String(20), unique=True)
    greeting = Column(Text, default="Hello, thank you for calling. How may I assist you today?")
    fallback_message = Column(Text, default="I apologize, but I am unable to help with that request.")
    timezone = Column(String(50), default="UTC")
    business_hours = Column(JSON, default={
        "weekdays": {"open": "09:00", "close": "17:00"},
        "weekend": {"open": "10:00", "close": "14:00"}
    })
    contact_email = Column(String(255))
    contact_phone = Column(String(20))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    services = relationship("CompanyService", back_populates="company", cascade="all, delete-orphan")
    documents = relationship("KnowledgeDocument", back_populates="company", cascade="all, delete-orphan")
    interactions = relationship("Interaction", back_populates="company", cascade="all, delete-orphan")
    api_keys = relationship("ApiKey", back_populates="company", cascade="all, delete-orphan")
    users = relationship("CompanyUser", back_populates="company", cascade="all, delete-orphan")


class CompanyService(Base):
    __tablename__ = "company_services"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    pricing = Column(Text)
    duration_minutes = Column(Integer)
    is_bookable = Column(Boolean, default=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    company = relationship("Company", back_populates="services")


class KnowledgeDocument(Base):
    __tablename__ = "knowledge_documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    filename = Column(String(255), nullable=False)
    original_name = Column(String(255))
    content_type = Column(String(50), nullable=False)
    file_size = Column(Integer)
    chunk_count = Column(Integer, default=0)
    pinecone_namespace = Column(String(255))
    status = Column(String(20), default="pending")
    error_message = Column(Text)
    uploaded_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    indexed_at = Column(DateTime(timezone=True))

    company = relationship("Company", back_populates="documents")


class Interaction(Base):
    __tablename__ = "interactions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    type = Column(String(50), nullable=False)
    status = Column(String(50), default="new")
    customer_name = Column(String(255))
    customer_phone = Column(String(20), nullable=False)
    customer_email = Column(String(255))
    service_id = Column(UUID(as_uuid=True), ForeignKey("company_services.id"))
    data = Column(JSON, default={})
    summary = Column(Text)
    transcript = Column(Text)
    sentiment = Column(String(20))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    company = relationship("Company", back_populates="interactions")


class CallLog(Base):
    __tablename__ = "call_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="SET NULL"))
    twilio_call_sid = Column(String(50), unique=True)
    from_number = Column(String(20), nullable=False)
    to_number = Column(String(20), nullable=False)
    direction = Column(String(20), default="inbound")
    status = Column(String(50))
    duration_seconds = Column(Integer)
    interaction_id = Column(UUID(as_uuid=True), ForeignKey("interactions.id"))
    transcript = Column(Text)
    audio_url = Column(Text)
    started_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    ended_at = Column(DateTime(timezone=True))


class TrialSession(Base):
    __tablename__ = "trial_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_name = Column(String(255), nullable=False)
    agent_type = Column(String(50), nullable=False)
    phone_number = Column(String(20), nullable=False)
    company_context = Column(Text, nullable=False)
    special_instructions = Column(Text)
    status = Column(String(50), default="pending")
    external_call_id = Column(String(100))
    external_conversation_id = Column(String(100))
    response_payload = Column(JSON, default={})
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class ApiKey(Base):
    __tablename__ = "api_keys"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    key_hash = Column(String(255), nullable=False)
    name = Column(String(100))
    permissions = Column(JSON, default=["read"])
    last_used_at = Column(DateTime(timezone=True))
    expires_at = Column(DateTime(timezone=True))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    company = relationship("Company", back_populates="api_keys")
