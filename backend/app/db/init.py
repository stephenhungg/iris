from app.db.base import Base
from app.db.session import engine

# import all models so Base.metadata is populated
from app import models  # noqa: F401


async def create_all() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
