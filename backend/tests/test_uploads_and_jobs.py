from pathlib import Path

from fastapi.testclient import TestClient

from app.models import Job
from app.worker.runner import Worker, recover_interrupted
from app.worker.stages import STAGE_KEYS
from tests.conftest import JPEG, PNG, photos, upload, zip_bytes


def test_upload_needs_a_curator(client: TestClient) -> None:
    response = client.post("/api/v1/uploads", data={"title": "Vase"}, files=photos(5))
    assert response.status_code == 401


def test_upload_queues_a_job_and_a_processing_object(curator: TestClient) -> None:
    body = upload(curator, real_height_mm="245", tags="Ceramic, vase,ceramic")
    assert body["job"]["status"] == "queued"
    assert body["job"]["photo_count"] == 5
    assert body["object"]["status"] == "processing"
    assert body["object"]["tags"] == ["ceramic", "vase"]
    with curator.app.state.sessionmaker() as db:
        job = db.get(Job, body["job"]["id"])
        assert job.options == {"real_height_mm": 245.0}
        assert len(list(Path(job.input_path).iterdir())) == 5


def test_too_few_photos_are_refused(curator: TestClient) -> None:
    response = curator.post("/api/v1/uploads", data={"title": "Vase"}, files=photos(2))
    assert response.status_code == 422
    assert "At least 3 photos" in response.json()["detail"]


def test_a_file_that_only_pretends_to_be_a_photo_is_refused(curator: TestClient) -> None:
    files = photos(3) + [("files", ("evil.jpg", b"<script>alert(1)</script>", "image/jpeg"))]
    response = curator.post("/api/v1/uploads", data={"title": "Vase"}, files=files)
    assert response.status_code == 422
    assert "evil.jpg" in response.json()["detail"]


def test_png_photos_are_accepted(curator: TestClient) -> None:
    response = curator.post("/api/v1/uploads", data={"title": "Vase"}, files=photos(3, PNG))
    assert response.status_code == 201


def test_oversized_photo_is_refused_and_nothing_is_kept(curator: TestClient, settings) -> None:  # noqa: ANN001
    big = JPEG + b"\x00" * settings.max_photo_bytes
    response = curator.post("/api/v1/uploads", data={"title": "Vase"}, files=photos(3) + photos(1, big))
    assert response.status_code == 413
    assert not any((settings.storage_dir / "uploads").iterdir())


def test_zip_entries_cannot_escape_the_upload_folder(curator: TestClient, settings, tmp_path) -> None:  # noqa: ANN001
    archive = zip_bytes(
        {
            "../../../escape.jpg": JPEG,
            "/abs/escape2.jpg": JPEG,
            "photos/a.jpg": JPEG,
            "__MACOSX/._a.jpg": b"junk",
            "README.txt": b"not a photo",
        }
    )
    response = curator.post(
        "/api/v1/uploads", data={"title": "Vase"}, files=[("files", ("set.zip", archive, "application/zip"))]
    )
    assert response.status_code == 201, response.text
    assert response.json()["job"]["photo_count"] == 3
    assert response.json()["skipped_files"] == 1
    assert not (tmp_path / "escape.jpg").exists()
    stored = [p for p in (settings.storage_dir / "uploads").rglob("*") if p.is_file()]
    assert sorted(p.name for p in stored) == ["0001.jpg", "0002.jpg", "0003.jpg"]


def test_demo_pipeline_runs_every_stage_and_publishes_a_flagged_object(curator: TestClient, worker: Worker) -> None:
    body = upload(curator)
    assert worker.run_once() is True
    job = curator.get(f"/api/v1/jobs/{body['job']['id']}").json()
    assert job["status"] == "done", job
    assert job["progress"] == 100
    assert job["pipeline"] == "demo"
    assert set(job["stage_times"]) == set(STAGE_KEYS)
    assert "not a reconstruction of them" in job["log"]

    obj = curator.get(f"/api/v1/objects/{body['object']['id']}").json()
    assert obj["status"] == "ready"
    assert obj["is_demo"] is True
    assert curator.get(obj["model_url"]).content.startswith(b"glTF")
    assert worker.run_once() is False  # Nothing left in the queue.


def test_a_queued_job_can_be_cancelled_and_retried(curator: TestClient, worker: Worker) -> None:
    body = upload(curator)
    job_id = body["job"]["id"]
    assert curator.post(f"/api/v1/jobs/{job_id}/cancel").json()["status"] == "cancelled"
    assert curator.get(f"/api/v1/objects/{body['object']['id']}").json()["status"] == "failed"
    assert curator.post(f"/api/v1/jobs/{job_id}/cancel").status_code == 409

    assert curator.post(f"/api/v1/jobs/{job_id}/retry").json()["status"] == "queued"
    worker.run_once()
    assert curator.get(f"/api/v1/jobs/{job_id}").json()["status"] == "done"
    assert curator.get(f"/api/v1/jobs/{job_id}").json()["attempts"] == 1


def test_a_failing_pipeline_marks_the_job_and_object_failed(curator: TestClient, worker: Worker, settings) -> None:  # noqa: ANN001
    (settings.samples_dir / settings.demo_model).unlink()
    body = upload(curator)
    worker.run_once()
    job = curator.get(f"/api/v1/jobs/{body['job']['id']}").json()
    assert job["status"] == "failed"
    assert "sample model is missing" in job["error"]
    assert curator.get(f"/api/v1/objects/{body['object']['id']}").json()["status"] == "failed"


def test_jobs_interrupted_by_a_restart_become_retryable_failures(curator: TestClient) -> None:
    body = upload(curator)
    sessions = curator.app.state.sessionmaker
    with sessions() as db:
        db.get(Job, body["job"]["id"]).status = "running"
        db.commit()
    assert recover_interrupted(sessions) == 1
    job = curator.get(f"/api/v1/jobs/{body['job']['id']}").json()
    assert job["status"] == "failed" and "Retry" in job["error"]


def test_job_list_filters_by_state(curator: TestClient, worker: Worker) -> None:
    upload(curator)
    upload(curator)
    worker.run_once()
    assert len(curator.get("/api/v1/jobs?status=active").json()) == 1
    assert len(curator.get("/api/v1/jobs?status=done").json()) == 1
    assert len(curator.get("/api/v1/jobs").json()) == 2


def _context(curator: TestClient, settings):  # noqa: ANN001, ANN202
    from app.worker.runner import JobContext

    body = upload(curator)
    sessions = curator.app.state.sessionmaker
    with sessions() as db:
        return JobContext(sessions, settings, db.get(Job, body["job"]["id"])), body["job"]["id"]


def test_child_output_is_saved_in_batches(curator: TestClient, settings) -> None:  # noqa: ANN001
    import sys

    from app.worker.runner import run_process

    ctx, job_id = _context(curator, settings)
    writes: list[str] = []
    save = ctx.log
    ctx.log = lambda text: (writes.append(text), save(text))  # type: ignore[method-assign]
    output = run_process(ctx, [sys.executable, "-c", "for i in range(2000): print(i)"])
    assert len(output) == 2000
    assert len(writes) <= 3  # Not one database write per line.
    assert curator.get(f"/api/v1/jobs/{job_id}").json()["log"].rstrip().endswith("1999")


def test_a_chatty_child_process_is_stopped_when_the_job_is_cancelled(curator: TestClient, settings) -> None:  # noqa: ANN001
    import sys
    import threading
    import time

    import pytest

    from app.worker.runner import JobCancelled, run_process

    ctx, job_id = _context(curator, settings)

    def cancel_soon() -> None:
        time.sleep(0.5)
        with curator.app.state.sessionmaker() as db:
            db.get(Job, job_id).cancel_requested = True
            db.commit()

    threading.Thread(target=cancel_soon, daemon=True).start()
    started = time.monotonic()
    with pytest.raises(JobCancelled):
        run_process(ctx, [sys.executable, "-c", "while True: print('x' * 80, flush=True)"])
    assert time.monotonic() - started < 10  # The old check waited for a quiet second that never came.
