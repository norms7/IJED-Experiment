"""
LMS Admin Backend — FastAPI entry point.

Run:
    uvicorn app.main:app --reload --port 8000

Docs:
    http://localhost:8000/docs   (Swagger UI)
    http://localhost:8000/redoc  (ReDoc)
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

# ── Rate limiting ──────────────────────────────────────────────────────────────
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from app.core.limiter import limiter

from app.core.config import settings
from app.api.v1.router import api_router
from app.api.v1.endpoints.notifications import notif_router


# ── Lifespan (startup / shutdown) ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("✅  LMS Admin API started")
    yield
    print("🛑  LMS Admin API shutting down")


# ── App factory ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="LMS Admin API",
    description=(
        "Backend for the Learning Management System admin dashboard. "
        "All endpoints under `/admin/*` require a valid Bearer JWT token obtained "
        "from `POST /auth/login`."
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── Attach limiter to app state (required by slowapi) ─────────────────────────
app.state.limiter = limiter

# ── Register the 429 handler FIRST before any other middleware ─────────────────
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS — must come before SlowAPIMiddleware ──────────────────────────────────
# IMPORTANT: CORSMiddleware must be added FIRST so that even 500 errors from
# the database still return an Access-Control-Allow-Origin header. Without this,
# the browser reports a CORS error instead of the real 500, masking the true bug.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── SlowAPI middleware ─────────────────────────────────────────────────────────
app.add_middleware(SlowAPIMiddleware)

# ── Global exception handlers ─────────────────────────────────────────────────

@app.exception_handler(IntegrityError)
async def integrity_error_handler(request: Request, exc: IntegrityError):
    """Catch unhandled DB unique-constraint violations and return a clean 409."""
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": "Database constraint violation. Record may already exist."},
    )

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """
    Catch-all handler so that 500 errors always return a JSON response
    WITH the CORS header attached (FastAPI's default 500 does not go through
    CORSMiddleware when the error happens before the response is built).
    """
    import logging
    logging.getLogger("uvicorn.error").exception("Unhandled exception", exc_info=exc)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error. Please try again."},
    )

# ── Routes ────────────────────────────────────────────────────────────────────

app.include_router(api_router, prefix="/api/v1")

# Convenience: also mount without /api/v1 prefix for direct /auth/login etc.
app.include_router(api_router)

# Notifications mounted ONCE directly to avoid double-mount route conflicts
app.include_router(notif_router)


@app.get("/", tags=["Health"])
async def root():
    return {
        "service": "LMS Admin API",
        "version": "1.0.0",
        "docs": "/docs",
        "status": "running",
    }


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "ok"}