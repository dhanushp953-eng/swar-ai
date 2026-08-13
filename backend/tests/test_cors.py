from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

LAN_ORIGIN = "http://192.168.29.53:3001"


def test_lan_preflight_is_reflected():
    with TestClient(create_app(Settings(cors_reflect_lan=True))) as client:
        response = client.options(
            "/api/analyze",
            headers={
                "Origin": LAN_ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
    assert response.status_code == 204
    assert response.headers.get("access-control-allow-origin") == LAN_ORIGIN
    assert "POST" in response.headers.get("access-control-allow-methods", "")


def test_lan_post_response_reflects_origin():
    with TestClient(create_app(Settings(cors_reflect_lan=True))) as client:
        response = client.get("/health", headers={"Origin": LAN_ORIGIN})
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == LAN_ORIGIN


def test_explicit_localhost_origin_is_allowed():
    with TestClient(create_app(Settings(cors_reflect_lan=True))) as client:
        response = client.get("/health", headers={"Origin": "http://localhost:3001"})
    assert response.headers.get("access-control-allow-origin") == "http://localhost:3001"


def test_unknown_origin_is_not_reflected():
    with TestClient(create_app(Settings(cors_reflect_lan=True))) as client:
        response = client.get("/health", headers={"Origin": "http://evil.example.com"})
    assert "access-control-allow-origin" not in response.headers


def test_reflect_can_be_disabled():
    with TestClient(create_app(Settings(cors_reflect_lan=False))) as client:
        response = client.get("/health", headers={"Origin": LAN_ORIGIN})
    assert "access-control-allow-origin" not in response.headers
