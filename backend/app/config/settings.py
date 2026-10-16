"""
Application settings loaded from environment variables.
"""

from pydantic_settings import BaseSettings
from pydantic import Field
from functools import lru_cache
import os


class Settings(BaseSettings):
    """Application configuration from environment variables."""

    # App
    app_name: str = "OmniVoice Agent API"
    debug: bool = False
    api_base_url: str = "http://localhost:8000"
    frontend_url: str = "http://localhost:3000"

    # Resource and abuse controls (quotas are shared through the application DB)
    production_mode: bool = False
    rate_limit_enabled: bool = True
    public_demo_enabled: bool = True
    ip_requests_per_minute: int = Field(600, ge=1, le=100000)
    api_requests_per_minute: int = Field(180, ge=1, le=10000)
    uploads_per_minute: int = Field(120, ge=1, le=10000)
    max_request_bytes: int = Field(25165824, ge=1024, le=25165824)
    request_body_timeout_seconds: int = Field(30, ge=1, le=120)
    max_documents: int = Field(100, ge=1, le=100)
    max_workspace_characters: int = Field(5000000, ge=1, le=5000000)
    max_document_characters: int = Field(200000, ge=10, le=200000)
    parser_concurrency: int = Field(2, ge=1, le=8)
    parser_timeout_seconds: int = Field(150, ge=1, le=300)
    ocr_enabled: bool = True
    ocr_review_required: bool = True
    ocr_languages: str = "eng"
    ocr_dpi: int = Field(300, ge=150, le=400)
    ocr_min_confidence: float = Field(70, ge=0, le=100)
    pdf_max_pages: int = Field(100, ge=1, le=1000)
    pdf_max_ocr_pages: int = Field(30, ge=1, le=100)
    pdf_max_render_pixels: int = Field(20000000, ge=100000, le=30000000)

    # Security services are required in production; no dummy secrets are generated.
    malware_scan_enabled: bool = False
    malware_scan_timeout_seconds: int = Field(30, ge=1, le=120)
    clamd_socket: str = ""
    clamd_host: str = "127.0.0.1"
    clamd_port: int = Field(3310, ge=1, le=65535)
    parser_sandbox_required: bool = False
    data_encryption_keys: dict[str, str] = {}
    data_encryption_active_key: str = ""
    allow_legacy_plaintext_reads: bool = True

    # Database
    database_url: str = "sqlite+aiosqlite:///./local.db"  # Defaults to local SQLite if not set

    # ElevenLabs Agents
    elevenlabs_api_key: str = ""
    elevenlabs_agent_id: str = ""
    elevenlabs_phone_number_id: str = ""
    elevenlabs_base_url: str = "https://api.elevenlabs.io"

    # Live operations are disabled until explicitly enabled by the operator.
    live_calls_enabled: bool = False
    integration_api_key: str = ""
    elevenlabs_company_agents: dict[str, str] = {}

    rag_embedding_model: str = "e5_mistral_7b_instruct"
    rag_index_timeout_seconds: int = 180
    web_voice_enabled: bool = False
    elevenlabs_webhook_secret: str = ""

    # Support email outbox (no credentials required for local previews)
    email_enabled: bool = False
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_starttls: bool = True

    # Auth
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expiry_minutes: int = 60

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


@lru_cache()
def get_settings() -> Settings:
    """Cached settings instance."""
    return Settings(_env_file=None) if os.getenv("PARSER_ISOLATED") else Settings()
