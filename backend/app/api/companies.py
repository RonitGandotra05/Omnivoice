"""
Companies API – CRUD operations for multi-tenant companies.
"""

import secrets
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
import bcrypt

from app.config.database import get_db
from app.models.models import Company, CompanyService, ApiKey
from app.utils.company_config import invalidate_cache
from app.models.schemas import (
    CompanyCreate,
    CompanyUpdate,
    CompanyResponse,
    CompanyListItem,
    PaginatedResponse,
)

from app.utils.access import require_operator

router = APIRouter(dependencies=[Depends(require_operator)])


@router.get("")
async def list_companies(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """List all companies with pagination."""
    offset = (page - 1) * limit

    total_q = await db.execute(select(func.count(Company.id)))
    total = total_q.scalar() or 0

    result = await db.execute(
        select(Company)
        .order_by(Company.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    companies = result.scalars().all()

    return {
        "companies": [CompanyListItem.model_validate(c) for c in companies],
        "pagination": PaginatedResponse(
            page=page, limit=limit, total=total, pages=max(1, -(-total // limit))
        ),
    }


@router.get("/{company_id}")
async def get_company(company_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get a single company with its services."""
    result = await db.execute(
        select(Company)
        .options(selectinload(Company.services))
        .where(Company.id == company_id)
    )
    company = result.scalar_one_or_none()
    if company is None:
        raise HTTPException(404, "Company not found")
    return {"company": CompanyResponse.model_validate(company)}


@router.post("", status_code=201)
async def create_company(body: CompanyCreate, db: AsyncSession = Depends(get_db)):
    """Create a new company with optional services. Returns an API key (shown once!)."""

    # Check slug uniqueness
    slug = body.slug.lower().replace(" ", "-")
    exists = await db.execute(select(Company.id).where(Company.slug == slug))
    if exists.scalar_one_or_none():
        raise HTTPException(409, "Slug already exists")

    company = Company(
        services=[],
        name=body.name,
        slug=slug,
        phone_number=body.phone_number,
        greeting=body.greeting,
        fallback_message=body.fallback_message,
        timezone=body.timezone or "UTC",
        business_hours=body.business_hours,
        contact_email=body.contact_email,
        contact_phone=body.contact_phone,
    )
    db.add(company)
    await db.flush()  # get company.id

    # Add services
    for svc in body.services or []:
        company.services.append(CompanyService(
            company_id=company.id,
            name=svc.name,
            description=svc.description,
            pricing=svc.pricing,
            duration_minutes=svc.duration_minutes,
            is_bookable=svc.is_bookable,
        ))

    # Generate API key
    raw_key = f"sk_{secrets.token_hex(24)}"
    db.add(ApiKey(
        company_id=company.id,
        key_hash=bcrypt.hashpw(raw_key.encode(), bcrypt.gensalt()).decode(),
        name="Default API Key",
        permissions=["read", "write"],
    ))

    await db.flush()

    return {
        "company": CompanyResponse.model_validate(company),
        "apiKey": raw_key,
        "message": "Company created successfully. Save your API key – it will not be shown again!",
    }


@router.put("/{company_id}")
async def update_company(
    company_id: UUID,
    body: CompanyUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a company's details."""
    result = await db.execute(select(Company).options(selectinload(Company.services)).where(Company.id == company_id))
    company = result.scalar_one_or_none()
    if company is None:
        raise HTTPException(404, "Company not found")

    updates = body.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(company, field, value)

    await db.flush()
    invalidate_cache(str(company_id))
    return {"company": CompanyResponse.model_validate(company)}


@router.delete("/{company_id}")
async def delete_company(company_id: UUID, db: AsyncSession = Depends(get_db)):
    """Soft-delete (deactivate) a company."""
    result = await db.execute(select(Company).options(selectinload(Company.services)).where(Company.id == company_id))
    company = result.scalar_one_or_none()
    if company is None:
        raise HTTPException(404, "Company not found")

    company.is_active = False
    await db.flush()
    invalidate_cache(str(company_id))
    return {"message": "Company deactivated", "id": str(company.id)}
