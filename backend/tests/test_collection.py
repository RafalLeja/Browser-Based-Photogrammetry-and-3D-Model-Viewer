from fastapi.testclient import TestClient

from app.worker.runner import Worker
from tests.conftest import PNG, upload

PIN = {"position": [0.1, 0.2, 0.3], "normal": [0, 1, 0], "title": "Chip", "text": "Glaze chipped here."}


def publish(client: TestClient, worker: Worker, title: str, tags: str = "") -> int:
    body = upload(client, title=title, tags=tags)
    worker.run_once()
    return body["object"]["id"]


def test_visitors_only_see_published_objects(curator: TestClient, worker: Worker) -> None:
    ready = publish(curator, worker, "Amphora")
    draft = upload(curator, title="Unfinished")["object"]["id"]

    curator.post("/api/v1/auth/logout")
    listing = curator.get("/api/v1/objects").json()
    assert [o["id"] for o in listing["items"]] == [ready]
    assert curator.get(f"/api/v1/objects/{draft}").status_code == 404
    assert curator.get(f"/api/v1/objects/{draft}/model").status_code == 404


def test_search_tags_sort_and_pages(curator: TestClient, worker: Worker) -> None:
    publish(curator, worker, "Bronze helmet", "metal")
    publish(curator, worker, "Clay vase", "ceramic")
    publish(curator, worker, "Amber vase", "ceramic, resin")

    titles = lambda **q: [o["title"] for o in curator.get("/api/v1/objects", params=q).json()["items"]]  # noqa: E731
    assert titles(q="vase", sort="title") == ["Amber vase", "Clay vase"]
    assert titles(q="clay VASE") == ["Clay vase"]
    assert titles(tag="ceramic", sort="oldest") == ["Clay vase", "Amber vase"]
    page = curator.get("/api/v1/objects", params={"page_size": 2, "page": 2}).json()
    assert page["total"] == 3 and len(page["items"]) == 1
    assert curator.get("/api/v1/objects/tags").json()[0] == {"tag": "ceramic", "count": 2}


def test_curator_edits_metadata_and_text_is_cleaned(curator: TestClient, worker: Worker) -> None:
    object_id = publish(curator, worker, "Vase")
    response = curator.patch(
        f"/api/v1/objects/{object_id}",
        json={"title": "  Vase\x07 ", "description": "Song dynasty.\x1b[31m", "tags": ["A", "a", " b "], "dimensions_mm": [10, 20, 30]},
    )
    body = response.json()
    assert body["title"] == "Vase"
    assert body["description"] == "Song dynasty.[31m"
    assert body["tags"] == ["a", "b"]
    assert body["dimensions_mm"] == [10.0, 20.0, 30.0]
    assert curator.patch(f"/api/v1/objects/{object_id}", json={"title": ""}).status_code == 422
    assert curator.patch(f"/api/v1/objects/{object_id}", json={"up": [0, 1]}).status_code == 422


def test_delete_removes_the_object_and_its_annotations(curator: TestClient, worker: Worker) -> None:
    object_id = publish(curator, worker, "Vase")
    curator.post(f"/api/v1/objects/{object_id}/annotations", json=PIN)
    assert curator.delete(f"/api/v1/objects/{object_id}").status_code == 204
    assert curator.get(f"/api/v1/objects/{object_id}").status_code == 404
    assert curator.get(f"/api/v1/objects/{object_id}/annotations").status_code == 404


def test_annotation_lifecycle(curator: TestClient, worker: Worker) -> None:
    object_id = publish(curator, worker, "Vase")
    created = curator.post(f"/api/v1/objects/{object_id}/annotations", json=PIN)
    assert created.status_code == 201
    pin = created.json()
    assert pin["author"] == "Curator"

    edited = curator.patch(f"/api/v1/annotations/{pin['id']}", json={"text": "<b>bold</b>\x00"}).json()
    assert edited["text"] == "<b>bold</b>"  # Stored as text; the UI never renders it as HTML.
    assert edited["title"] == "Chip"

    assert curator.post(f"/api/v1/objects/{object_id}/annotations", json={**PIN, "position": [1, 2]}).status_code == 422
    assert curator.post(f"/api/v1/objects/{object_id}/annotations", json={**PIN, "title": "   "}).status_code == 422

    curator.post("/api/v1/auth/logout")
    assert [a["id"] for a in curator.get(f"/api/v1/objects/{object_id}/annotations").json()] == [pin["id"]]
    assert curator.post(f"/api/v1/objects/{object_id}/annotations", json=PIN).status_code == 401
    assert curator.delete(f"/api/v1/annotations/{pin['id']}").status_code == 401


def test_shared_views_round_trip_and_reject_unknown_fields(curator: TestClient, worker: Worker) -> None:
    object_id = publish(curator, worker, "Vase")
    state = {"position": [1, 2, 3], "target": [0, 0, 0], "environment": "studio", "exposure": 1.2}
    view = curator.post(f"/api/v1/objects/{object_id}/views", json=state).json()
    assert curator.get(f"/api/v1/views/{view['id']}").json()["state"]["environment"] == "studio"
    assert curator.post(f"/api/v1/objects/{object_id}/views", json={**state, "environment": "disco"}).status_code == 422
    assert curator.get("/api/v1/views/doesnotexist").status_code == 404


def test_thumbnail_upload_checks_the_image_type(curator: TestClient, worker: Worker) -> None:
    object_id = publish(curator, worker, "Vase")
    assert curator.put(f"/api/v1/objects/{object_id}/thumbnail", content=b"GIF89a....").status_code == 422
    body = curator.put(f"/api/v1/objects/{object_id}/thumbnail", content=PNG).json()
    assert curator.get(body["thumbnail_url"]).content == PNG


def test_cross_site_writes_are_refused_and_headers_are_set(curator: TestClient, worker: Worker) -> None:
    object_id = publish(curator, worker, "Vase")
    refused = curator.patch(f"/api/v1/objects/{object_id}", json={"title": "x"}, headers={"Origin": "https://evil.example"})
    assert refused.status_code == 403
    allowed = curator.patch(f"/api/v1/objects/{object_id}", json={"title": "x"}, headers={"Origin": "http://localhost:5173"})
    assert allowed.status_code == 200
    assert allowed.headers["x-content-type-options"] == "nosniff"


def test_pipeline_info_lists_the_stages(client: TestClient) -> None:
    info = client.get("/api/v1/pipeline").json()
    assert [s["key"] for s in info["stages"]][0] == "upload"
    assert info["limits"]["min_photos"] == 3


def test_model_downloads_revalidate_with_an_etag(curator: TestClient, worker: Worker) -> None:
    object_id = publish(curator, worker, "Vase")
    url = curator.get(f"/api/v1/objects/{object_id}").json()["model_url"]
    first = curator.get(url)
    assert first.status_code == 200 and first.headers["cache-control"] == "public, no-cache"
    again = curator.get(url, headers={"If-None-Match": first.headers["etag"]})
    assert again.status_code == 304 and again.content == b""


def test_delete_also_removes_the_photos_and_workspace_but_nothing_outside(
    curator: TestClient, worker: Worker, settings, tmp_path, monkeypatch  # noqa: ANN001
) -> None:
    from pathlib import Path

    from app.models import Job

    monkeypatch.setattr("app.services.files.WORKSPACES", tmp_path / "workspaces")
    body = upload(curator, title="Vase")
    worker.run_once()
    workspace = tmp_path / "workspaces" / "abc"
    workspace.mkdir(parents=True)
    outside = tmp_path / "not-ours"
    outside.mkdir()
    with curator.app.state.sessionmaker() as db:
        job = db.get(Job, body["job"]["id"])
        photos_dir = Path(job.input_path)
        job.options = {"workspace": str(workspace)}
        db.add(Job(object_id=body["object"]["id"], input_path=str(outside)))  # A path we never created.
        db.commit()
    assert photos_dir.is_dir() and any(photos_dir.iterdir())

    assert curator.delete(f"/api/v1/objects/{body['object']['id']}").status_code == 204
    assert not photos_dir.exists()
    assert not workspace.exists()
    assert outside.is_dir()


def test_a_new_cover_in_another_format_replaces_the_old_file(curator: TestClient, worker: Worker, settings) -> None:  # noqa: ANN001
    object_id = publish(curator, worker, "Vase")
    curator.put(f"/api/v1/objects/{object_id}/thumbnail", content=PNG)
    webp = b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"\x00" * 32
    assert curator.put(f"/api/v1/objects/{object_id}/thumbnail", content=webp).status_code == 200
    assert sorted(p.name for p in (settings.storage_dir / "thumbnails").iterdir()) == [f"{object_id}.webp"]


def test_the_default_demo_model_is_the_small_upright_sample() -> None:
    from app.core.config import REPO_ROOT, Settings

    assert Settings().demo_model == "models/eagle-web.glb"
    assert (REPO_ROOT / "samples" / Settings().demo_model).is_file()


def test_editing_details_or_the_cover_keeps_the_model_url(curator: TestClient, worker: Worker) -> None:
    from app.models import CollectionObject

    object_id = publish(curator, worker, "Vase")
    url = curator.get(f"/api/v1/objects/{object_id}").json()["model_url"]
    curator.patch(f"/api/v1/objects/{object_id}", json={"title": "Vase, renamed"})
    covered = curator.put(f"/api/v1/objects/{object_id}/thumbnail", content=PNG).json()
    assert covered["model_url"] == url  # The viewer must not download the model again.

    with curator.app.state.sessionmaker() as db:
        db.get(CollectionObject, object_id).file_size = 123  # A new model was published.
        db.commit()
    assert curator.get(f"/api/v1/objects/{object_id}").json()["model_url"] != url
