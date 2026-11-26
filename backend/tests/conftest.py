import io
import zipfile
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.worker.runner import Worker

CURATOR = {"login": "curator", "password": "correct horse battery staple"}
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 256
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 256


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    samples = tmp_path / "samples"
    (samples / "models").mkdir(parents=True)
    (samples / "models" / "demo.glb").write_bytes(b"glTF" + b"\x00" * 64)
    return replace(
        Settings(),
        database_url=f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        storage_dir=tmp_path / "storage",
        samples_dir=samples,
        pipeline="demo",
        embedded_worker=False,
        demo_stage_seconds=0,
        demo_model="models/demo.glb",
        curator_login=CURATOR["login"],
        curator_password=CURATOR["password"],
        seed_samples=False,
    )


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture
def curator(client: TestClient) -> TestClient:
    response = client.post("/api/v1/auth/login", json=CURATOR)
    assert response.status_code == 200, response.text
    return client


@pytest.fixture
def worker(client: TestClient, settings: Settings) -> Worker:
    return Worker(client.app.state.sessionmaker, settings)


def photos(count: int, data: bytes = JPEG) -> list[tuple[str, tuple[str, bytes, str]]]:
    return [("files", (f"IMG_{i:03d}.jpg", data, "image/jpeg")) for i in range(count)]


def zip_bytes(entries: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    return buffer.getvalue()


def upload(client: TestClient, count: int = 5, **form: str) -> dict:
    response = client.post("/api/v1/uploads", data={"title": "Vase", **form}, files=photos(count))
    assert response.status_code == 201, response.text
    return response.json()
