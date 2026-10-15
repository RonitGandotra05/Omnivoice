"""
Application settings loaded from environment variables.
"""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application configuration from environment variables."""

    # App
    app_name: str = "OmniVoice Agent API"
    debug: bool = False
    api_base_url: str = "http://localhost:8000"
    frontend_url: str = "http://localhost:3000"

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

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    """Cached settings instance."""
    return Settings()
