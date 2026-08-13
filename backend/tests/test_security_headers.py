from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def test_security_headers_present_on_get():
    with TestClient(create_app(Settings())) as client:
        response = client.get("/health")
    assert response.headers.get("x-content-type-options") == "nosniff"
    assert response.headers.get("x-frame-options") == "DENY"
    assert response.headers.get("referrer-policy") == "no-referrer"
    csp = response.headers.get("content-security-policy", "")
    assert "default-src 'none'" in csp
    assert "frame-ancestors 'none'" in csp


def test_security_headers_present_on_error_response():
    with TestClient(create_app(Settings())) as client:
        # Missing authorization -> 403; defensive headers must still be present.
        response = client.post(
            "/api/analyze",
            files={"file": ("tone.wav", b"", "audio/wav")},
        )
    assert response.status_code == 403
    assert response.headers.get("x-content-type-options") == "nosniff"
    assert response.headers.get("x-frame-options") == "DENY"
    assert response.headers.get("referrer-policy") == "no-referrer"


def test_security_headers_present_on_cors_preflight():
    with TestClient(create_app(Settings(cors_reflect_lan=True))) as client:
        response = client.options(
            "/api/analyze",
            headers={
                "Origin": "http://192.168.29.53:3001",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
    assert response.status_code == 204
    assert response.headers.get("x-content-type-options") == "nosniff"
    assert response.headers.get("x-frame-options") == "DENY"
    assert response.headers.get("referrer-policy") == "no-referrer"
