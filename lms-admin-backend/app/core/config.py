import os
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:password@localhost:5432/lms_db"
    SECRET_KEY: str = "changeme-in-production-use-long-random-string"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    # Supabase Storage
    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_KEY: str = ""

    # CORS origins — comma OR space separated in env var.
    # On Render, set CORS_ORIGINS in the environment dashboard to include
    # ALL required origins, e.g.:
    #   https://ijedlms.vercel.app http://localhost:5500
    # The Vercel production URL is always injected automatically below regardless
    # of what the env var contains.
    CORS_ORIGINS: str = (
        "http://localhost:3000 "
        "http://localhost:5500 "
        "http://localhost:5501 "
        "http://127.0.0.1:5500 "
        "http://127.0.0.1:5501 "
        "http://localhost:8080 "
        "http://127.0.0.1:8080 "
        "https://ijedlms.vercel.app"
    )

    # Production URLs that must always be allowed regardless of env var value.
    _ALWAYS_ALLOW: list[str] = [
        "https://ijedlms.vercel.app",
    ]

    @property
    def cors_origins_list(self) -> list[str]:
        # Support both comma-separated and space-separated values
        raw = self.CORS_ORIGINS.replace(",", " ")
        origins = [o.strip() for o in raw.split() if o.strip()]
        # Ensure production URLs are always present even if env var omits them
        for url in self._ALWAYS_ALLOW:
            if url not in origins:
                origins.append(url)
        return origins

    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
