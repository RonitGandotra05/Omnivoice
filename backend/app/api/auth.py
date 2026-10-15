from datetime import datetime, timedelta
from jose import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from app.utils.access import require_operator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.config.database import get_db
from app.config.settings import get_settings
from app.models.models import User
from app.models.schemas import SSOLoginRequest, TokenResponse

router = APIRouter(dependencies=[Depends(require_operator)])
settings = get_settings()


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """Generate a JWT token for the authenticated user."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.jwt_expiry_minutes)
        
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return encoded_jwt


@router.post("/sso-login", response_model=TokenResponse)
async def sso_login(request: SSOLoginRequest, db: AsyncSession = Depends(get_db)):
    """
    Handle SSO login from NextAuth (Google/Apple/LinkedIn).
    Finds existing user by email, or creates a new one.
    Returns a JWT access token.
    """
    # 1. Check if user exists by email
    stmt = select(User).where(User.email == request.email)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user:
        # 2. Create new user record for this SSO login
        user = User(
            email=request.email,
            name=request.name,
            sso_provider=request.provider,
            sso_id=request.sso_id,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

    # 3. If user exists but logged in with a different provider originally, 
    # we just let them in (email is the ultimate source of truth here), 
    # but we could optionally update the sso_provider/sso_id fields.
    if user.sso_provider != request.provider or user.sso_id != request.sso_id:
        user.sso_provider = request.provider
        user.sso_id = request.sso_id
        await db.commit()

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled."
        )

    # 4. Generate JWT
    access_token_expires = timedelta(minutes=settings.jwt_expiry_minutes)
    access_token = create_access_token(
        data={"sub": str(user.id), "email": user.email, "role": "user"},
        expires_delta=access_token_expires
    )

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user_id=user.id
    )
