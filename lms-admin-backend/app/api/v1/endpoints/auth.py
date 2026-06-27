from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.schemas.schemas import LoginRequest, TokenResponse
from app.services import auth_service

# Import the shared limiter instance created in main.py
from app.core.limiter import limiter

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.post("/login", response_model=TokenResponse, summary="Admin / User Login")
@limiter.limit("10/minute")                 # ← Max 10 login attempts per IP per minute
async def login(request: Request, data: LoginRequest, db: AsyncSession = Depends(get_db)):
    """
    Authenticate with email + password. Returns a JWT bearer token.
    Include the token as `Authorization: Bearer <token>` on all admin endpoints.

    Rate limited to **10 attempts per minute per IP address**.
    Exceeding this returns HTTP 429 Too Many Requests.
    """
    return await auth_service.login(db, data)