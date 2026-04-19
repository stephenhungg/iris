from sqlalchemy import text

from app.db.base import Base
from app.db.session import engine

# import all models so Base.metadata is populated
from app import models  # noqa: F401


# lightweight idempotent ddl that runs every boot. use this for additive
# schema changes so existing deployments auto-upgrade without a real
# migration tool. postgres-only syntax (IF NOT EXISTS) but sqlite also
# accepts ALTER TABLE ADD COLUMN when the column is new.
_SCHEMA_UPGRADES_POSTGRES = [
    "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id VARCHAR",
    "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS email VARCHAR",
    "CREATE INDEX IF NOT EXISTS ix_sessions_user_id ON sessions (user_id)",
]


async def create_all() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        dialect = conn.dialect.name
        if dialect == "postgresql":
            for stmt in _SCHEMA_UPGRADES_POSTGRES:
                await conn.execute(text(stmt))
