from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def test_required_vercel_routes():
    settings = Settings()
    with TestClient(create_app(settings)) as client:
        # 1. GET /api/health
        health_resp = client.get("/api/health")
        assert health_resp.status_code == 200
        assert health_resp.json()["status"] == "ok"

        # 2. GET /api/ai/providers/status
        status_resp = client.get("/api/ai/providers/status")
        assert status_resp.status_code == 200
        assert "providers" in status_resp.json()

        # 3. POST /api/tutor/advice
        advice_resp = client.post(
            "/api/tutor/advice",
            json={
                "lesson_name": "Test Lesson",
                "expected_notes": [{"name": "C4", "start": 0.0, "duration": 0.5, "hand": "right"}],
                "scores": {"overall": 80, "pitch": 90, "timing": 70, "rhythm": 80},
                "mistake_counts": {"wrong_pitch": 0, "early": 1, "late": 0, "missed": 0, "extra": 0},
                "difficult_notes": [],
                "practice_mode": "full",
            },
        )
        assert advice_resp.status_code == 200
        assert "advice" in advice_resp.json()

        # 4. POST /api/analyze validation check
        analyze_resp = client.post("/api/analyze")
        assert analyze_resp.status_code in {403, 422}  # Requires multipart file & authorization

        # 5. GET /api/jobs/{job_id} not found check
        job_resp = client.get("/api/jobs/non-existent-job-id")
        assert job_resp.status_code == 404
