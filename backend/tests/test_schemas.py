"""
Tests for Pydantic schema validation.
"""

import pytest
from pydantic import ValidationError
from app.models.schemas import CompanyCreate, CompanyUpdate, QueryRequest, TryForFreeRequest, TrialAgentType


class TestCompanyCreate:
    """Test CompanyCreate schema validation."""

    def test_valid_company(self):
        company = CompanyCreate(name="Test Corp", slug="test-corp")
        assert company.name == "Test Corp"
        assert company.slug == "test-corp"

    def test_empty_name_rejected(self):
        with pytest.raises(ValidationError) as exc_info:
            CompanyCreate(name="", slug="test-corp")
        assert "min_length" in str(exc_info.value).lower() or "at least" in str(exc_info.value).lower()

    def test_invalid_slug_rejected(self):
        with pytest.raises(ValidationError):
            CompanyCreate(name="Test", slug="INVALID SLUG!")

    def test_slug_normalized_to_lowercase(self):
        company = CompanyCreate(name="Test", slug="My-Company")
        assert company.slug == "my-company"

    def test_valid_email_accepted(self):
        company = CompanyCreate(
            name="Test", slug="test", contact_email="admin@example.com"
        )
        assert company.contact_email == "admin@example.com"

    def test_invalid_email_rejected(self):
        with pytest.raises(ValidationError):
            CompanyCreate(name="Test", slug="test", contact_email="not-an-email")

    def test_valid_phone_accepted(self):
        company = CompanyCreate(
            name="Test", slug="test", phone_number="+14155551234"
        )
        assert company.phone_number == "+14155551234"

    def test_invalid_phone_rejected(self):
        with pytest.raises(ValidationError):
            CompanyCreate(name="Test", slug="test", phone_number="abc123")

    def test_short_phone_rejected(self):
        with pytest.raises(ValidationError):
            CompanyCreate(name="Test", slug="test", phone_number="+1")


class TestCompanyUpdate:
    """Test CompanyUpdate schema validation."""

    def test_partial_update_allowed(self):
        update = CompanyUpdate(name="New Name")
        assert update.name == "New Name"
        assert update.phone_number is None

    def test_invalid_email_rejected(self):
        with pytest.raises(ValidationError):
            CompanyUpdate(contact_email="bad")

    def test_all_none_allowed(self):
        update = CompanyUpdate()
        assert update.name is None


class TestQueryRequest:
    """Test QueryRequest schema validation."""

    def test_valid_query(self):
        req = QueryRequest(
            query="What are your hours?",
            twilio_number="+14155551234",
            customer_phone="+14155559999",
        )
        assert req.query == "What are your hours?"

    def test_empty_query_rejected(self):
        with pytest.raises(ValidationError):
            QueryRequest(
                query="",
                twilio_number="+14155551234",
                customer_phone="+14155559999",
            )

    def test_invalid_twilio_number_rejected(self):
        with pytest.raises(ValidationError):
            QueryRequest(
                query="Hello",
                twilio_number="not-a-phone",
                customer_phone="+14155559999",
            )


class TestTryForFreeRequest:
    """Test trial call request validation."""

    def test_valid_trial_request(self):
        req = TryForFreeRequest(
            company_name="Acme Support",
            agent_type=TrialAgentType.customer_support,
            phone_number="+14155551234",
            company_context="Hours are 9 to 5. Offer support and escalate billing questions.",
            special_instructions="Be concise.",
        )
        assert req.company_name == "Acme Support"
        assert req.agent_type == TrialAgentType.customer_support

    def test_invalid_trial_phone_rejected(self):
        with pytest.raises(ValidationError):
            TryForFreeRequest(
                company_name="Acme",
                agent_type=TrialAgentType.booking,
                phone_number="555-1234",
                company_context="We book tables between 5 PM and 10 PM.",
            )

    def test_short_company_context_rejected(self):
        with pytest.raises(ValidationError):
            TryForFreeRequest(
                company_name="Acme",
                agent_type=TrialAgentType.feedback,
                phone_number="+14155551234",
                company_context="Too short",
            )
