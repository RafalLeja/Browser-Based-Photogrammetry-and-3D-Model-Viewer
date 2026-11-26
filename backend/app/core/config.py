"""Settings read once from the environment (and backend/.env). Tests build their own."""

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy.engine import URL

BACKEND_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_ROOT.parent

load_dotenv(BACKEND_ROOT / ".env")


def _bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _database_url() -> str:
    if url := os.getenv("DATABASE_URL"):
        return url
    # The variables of the first Postgres setup (DB_HOST, DB_USER, ...) keep working.
    if os.getenv("DB_HOST"):
        return URL.create(
            drivername="postgresql+psycopg",
            username=os.getenv("DB_USER"),
            password=os.getenv("DB_PASSWORD"),
            host=os.getenv("DB_HOST"),
            port=int(os.getenv("DB_PORT", "5432")),
            database=os.getenv("DB_NAME"),
        ).render_as_string(hide_password=False)
    return f"sqlite:///{(BACKEND_ROOT / 'storage' / 'vitrine.db').as_posix()}"


@dataclass(frozen=True)
class Settings:
    database_url: str = field(default_factory=_database_url)
    storage_dir: Path = BACKEND_ROOT / "storage"
    samples_dir: Path = REPO_ROOT / "samples"
    cors_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")
    # auto: COLMAP when pycolmap sees a CUDA GPU, otherwise the labelled demo pipeline.
    pipeline: str = "auto"
    embedded_worker: bool = True
    demo_stage_seconds: float = 1.5
    # The cleaned, upright 2.2 MB eagle: what the real pipeline would publish.
    demo_model: str = "models/eagle-web.glb"
    session_days: int = 14
    cookie_secure: bool = False
    curator_login: str | None = None
    curator_password: str | None = None
    seed_samples: bool = True
    min_photos: int = 3
    max_photos: int = 500
    max_photo_bytes: int = 40 * 1024 * 1024
    max_upload_bytes: int = 4 * 1024 * 1024 * 1024
    login_attempts_per_minute: int = 10
    uploads_per_hour: int = 30

    @classmethod
    def from_env(cls) -> "Settings":
        defaults = cls()
        origins = os.getenv("CORS_ORIGINS")
        return cls(
            storage_dir=Path(os.getenv("STORAGE_DIR", defaults.storage_dir)),
            samples_dir=Path(os.getenv("SAMPLES_DIR", defaults.samples_dir)),
            cors_origins=tuple(o.strip() for o in origins.split(",") if o.strip())
            if origins
            else defaults.cors_origins,
            pipeline=os.getenv("PIPELINE", defaults.pipeline),
            embedded_worker=_bool("EMBEDDED_WORKER", defaults.embedded_worker),
            demo_stage_seconds=float(os.getenv("DEMO_STAGE_SECONDS", defaults.demo_stage_seconds)),
            demo_model=os.getenv("DEMO_MODEL", defaults.demo_model),
            session_days=int(os.getenv("SESSION_DAYS", defaults.session_days)),
            cookie_secure=_bool("COOKIE_SECURE", defaults.cookie_secure),
            curator_login=os.getenv("CURATOR_LOGIN"),
            curator_password=os.getenv("CURATOR_PASSWORD"),
            seed_samples=_bool("SEED_SAMPLES", defaults.seed_samples),
        )
