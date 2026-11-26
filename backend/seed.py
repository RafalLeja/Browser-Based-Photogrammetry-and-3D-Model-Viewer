"""Seeds the database without starting the API: `uv run python seed.py`."""

from app.core.config import Settings
from app.database.base import Base
from app.database.session import make_engine, make_sessionmaker
from app.seed import seed

if __name__ == "__main__":
    settings = Settings.from_env()
    engine = make_engine(settings.database_url)
    Base.metadata.create_all(engine)
    with make_sessionmaker(engine)() as db:
        seed(db, settings)
    print("Seed complete.")
