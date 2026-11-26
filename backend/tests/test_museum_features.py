"""Museum record, licences and downloads, condition notes, visits, the dashboard and schema upgrades."""

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text

from app.database.migrate import add_missing_columns
from app.worker.runner import Worker
from tests.conftest import CURATOR, upload

PIN = {"position": [0.1, 0.2, 0.3], "normal": [0, 1, 0], "title": "Chip"}


def publish(client: TestClient, worker: Worker, title: str = "Vase") -> int:
    body = upload(client, title=title)
    worker.run_once()
    return body["object"]["id"]


def test_record_is_cleaned_searchable_and_cleared_with_null(curator: TestClient, worker: Worker) -> None:
    object_id = publish(curator, worker)
    record = {"accession_number": " 1987.12.4 ", "maker": "Unknown\x07", "date": "", "material": "Terracotta"}
    body = curator.patch(f"/api/v1/objects/{object_id}", json={"record": record, "license": "cc0", "alt_text": "A vase."}).json()
    assert body["record"] == {"accession_number": "1987.12.4", "maker": "Unknown", "material": "Terracotta"}
    assert body["license"] == "cc0" and body["downloadable"] is True and body["alt_text"] == "A vase."

    found = curator.get("/api/v1/objects", params={"q": "1987.12.4"}).json()["items"]
    assert [o["id"] for o in found] == [object_id]

    assert curator.patch(f"/api/v1/objects/{object_id}", json={"record": {"colour": "red"}}).status_code == 422
    assert curator.patch(f"/api/v1/objects/{object_id}", json={"license": "public"}).status_code == 422
    cleared = curator.patch(f"/api/v1/objects/{object_id}", json={"record": None, "license": None}).json()
    assert cleared["record"] == {} and cleared["license"] is None and cleared["downloadable"] is False
    assert cleared["title"] == "Vase"  # Untouched fields stay.


def test_visitors_download_only_openly_licensed_models(curator: TestClient, worker: Worker) -> None:
    object_id = publish(curator, worker, "Bronze Head")
    assert curator.get(f"/api/v1/objects/{object_id}/download").status_code == 200  # Curators always may.

    curator.post("/api/v1/auth/logout")
    assert curator.get(f"/api/v1/objects/{object_id}/download").status_code == 403

    curator.post("/api/v1/auth/login", json=CURATOR)
    curator.patch(f"/api/v1/objects/{object_id}", json={"license": "cc-by"})
    curator.post("/api/v1/auth/logout")
    response = curator.get(f"/api/v1/objects/{object_id}/download")
    assert response.status_code == 200
    assert 'filename="bronze-head.glb"' in response.headers["content-disposition"]


def test_condition_notes_keep_a_severity_only_for_damage(curator: TestClient, worker: Worker) -> None:
    object_id = publish(curator, worker)
    url = f"/api/v1/objects/{object_id}/annotations"
    damage = curator.post(url, json={**PIN, "category": "damage", "severity": "marked"}).json()
    assert (damage["category"], damage["severity"]) == ("damage", "marked")
    inscription = curator.post(url, json={**PIN, "category": "inscription", "severity": "slight"}).json()
    assert (inscription["category"], inscription["severity"]) == ("inscription", None)
    plain = curator.post(url, json=PIN).json()
    assert (plain["category"], plain["severity"]) == ("note", None)
    assert curator.post(url, json={**PIN, "category": "rumour"}).status_code == 422

    moved = curator.patch(f"/api/v1/annotations/{damage['id']}", json={"category": "repair"}).json()
    assert moved["severity"] is None
    again = curator.patch(f"/api/v1/annotations/{damage['id']}", json={"category": "damage", "severity": "slight"}).json()
    assert again["severity"] == "slight"
    assert curator.patch(f"/api/v1/annotations/{damage['id']}", json={"severity": None}).json()["severity"] is None


def test_a_visitor_counts_once_per_half_hour_and_curators_never(curator: TestClient, worker: Worker) -> None:
    object_id = publish(curator, worker)
    assert curator.post(f"/api/v1/objects/{object_id}/visit").status_code == 204
    assert curator.get(f"/api/v1/objects/{object_id}").json()["visits"] == 0  # A curator's visit.

    curator.post("/api/v1/auth/logout")
    for _ in range(3):
        assert curator.post(f"/api/v1/objects/{object_id}/visit").status_code == 204
    assert curator.get(f"/api/v1/objects/{object_id}").json()["visits"] == 1


def test_dashboard_stats_sum_up_the_collection(curator: TestClient, worker: Worker) -> None:
    first = publish(curator, worker, "Amphora")
    upload(curator, title="Still queued")
    curator.post(f"/api/v1/objects/{first}/annotations", json={**PIN, "category": "damage", "severity": "slight"})
    curator.post("/api/v1/auth/logout")
    curator.post(f"/api/v1/objects/{first}/visit")
    assert curator.get("/api/v1/stats").status_code == 401

    curator.post("/api/v1/auth/login", json=CURATOR)
    stats = curator.get("/api/v1/stats").json()
    assert stats["objects"] == {"total": 2, "ready": 1, "processing": 1, "failed": 0, "demo": 1}
    assert stats["jobs"]["done"] == 1 and stats["jobs"]["active"] == 1
    assert stats["notes"] == 1 and stats["notes_by_category"] == {"damage": 1}
    assert stats["visits"] == 1 and stats["top_objects"][0]["title"] == "Amphora"
    assert len(stats["jobs_by_day"]) == 30 and stats["jobs_by_day"][-1]["done"] == 1
    assert {"features", "publish"} <= set(stats["stage_seconds"])
    assert stats["storage_bytes"]["uploads"] > 0
    assert stats["storage_bytes"]["total"] == sum(v for k, v in stats["storage_bytes"].items() if k != "total")


def test_an_older_database_gains_the_new_columns_and_keeps_its_rows(tmp_path) -> None:  # noqa: ANN001
    from sqlalchemy.orm import Session

    from app.database.base import Base
    from app.models import Annotation, CollectionObject

    engine = create_engine(f"sqlite:///{(tmp_path / 'old.db').as_posix()}")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(CollectionObject(id=1, title="Amphora"))
        db.add(Annotation(object_id=1, position=[0, 0, 0], normal=[0, 1, 0], title="Chip"))
        db.commit()
    with engine.begin() as connection:  # Back to the version 1.0 tables, rows kept.
        for table, column in [("objects", "record"), ("objects", "license"), ("objects", "alt_text"), ("objects", "visits"),
                              ("annotations", "category"), ("annotations", "severity")]:
            connection.execute(text(f"ALTER TABLE {table} DROP COLUMN {column}"))

    added = add_missing_columns(engine)
    assert sorted(added) == ["annotations.category", "annotations.severity", "objects.alt_text", "objects.license", "objects.record", "objects.visits"]
    assert "visits" in {column["name"] for column in inspect(engine).get_columns("objects")}
    with engine.connect() as connection:
        assert tuple(connection.execute(text("SELECT title, visits FROM objects")).one()) == ("Amphora", 0)
        assert tuple(connection.execute(text("SELECT category, severity FROM annotations")).one()) == ("note", None)
    assert add_missing_columns(engine) == []  # Running again changes nothing.
