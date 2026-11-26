from dataclasses import replace

from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import CURATOR


def test_login_sets_an_httponly_cookie_and_me_returns_the_curator(client: TestClient) -> None:
    response = client.post("/api/v1/auth/login", json=CURATOR)
    assert response.status_code == 200
    assert response.json()["role"] == "curator"
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie
    assert client.get("/api/v1/auth/me").json()["login"] == CURATOR["login"]


def test_wrong_password_and_unknown_login_get_the_same_answer(client: TestClient) -> None:
    wrong = client.post("/api/v1/auth/login", json={**CURATOR, "password": "nope"})
    unknown = client.post("/api/v1/auth/login", json={"login": "ghost", "password": "nope"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


def test_logout_ends_the_session(curator: TestClient) -> None:
    assert curator.post("/api/v1/auth/logout").status_code == 204
    assert curator.get("/api/v1/auth/me").status_code == 401


def test_a_stolen_cookie_value_is_useless_after_logout(curator: TestClient) -> None:
    token = curator.cookies.get("vitrine_session")
    curator.post("/api/v1/auth/logout")
    curator.cookies.set("vitrine_session", token)
    assert curator.get("/api/v1/auth/me").status_code == 401


def test_login_is_rate_limited(settings) -> None:  # noqa: ANN001
    with TestClient(create_app(replace(settings, login_attempts_per_minute=3))) as client:
        codes = [client.post("/api/v1/auth/login", json={"login": "x", "password": "y"}).status_code for _ in range(4)]
    assert codes == [401, 401, 401, 429]


def test_writes_need_a_login(client: TestClient) -> None:
    assert client.patch("/api/v1/objects/1", json={"title": "x"}).status_code == 401
    assert client.post("/api/v1/uploads", data={"title": "x"}).status_code in (401, 422)
    assert client.get("/api/v1/jobs").status_code == 401
