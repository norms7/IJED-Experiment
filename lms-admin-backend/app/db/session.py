from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.core.config import settings

_db_url = settings.DATABASE_URL
_is_remote = (
    "supabase.com" in _db_url
    or "render.com" in _db_url
    or "amazonaws.com" in _db_url
)

if _is_remote:
    # NullPool — required for Transaction mode pooler (pgbouncer, port 6543).
    # Render uses IPv6 by default; Transaction pooler supports IPv6 but
    # Session pooler does not — so we stay on Transaction + NullPool.
    # statement_cache_size=0 and prepared_statement_cache_size=0 are required
    # for pgbouncer Transaction mode (prepared statements can't persist).
    engine = create_async_engine(
        _db_url,
        echo=False,
        poolclass=NullPool,
        connect_args={
            "ssl": "require",
            "statement_cache_size": 0,
            "prepared_statement_cache_size": 0,
        },
    )
else:
    engine = create_async_engine(
        _db_url,
        echo=False,
        pool_size=3,
        max_overflow=2,
        pool_pre_ping=True,
    )

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:  # type: ignore[return]
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
