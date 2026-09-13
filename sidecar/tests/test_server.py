"""HTTP surface: status codes and response shapes (models are exercised in test_models)."""

import json
import subprocess
import sys

from fastapi.testclient import TestClient

from audio_sidecar.server import app

client = TestClient(app)


def test_health_shape():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["device"] in ("cpu", "mps")
    assert set(body["models"]) == {"vad", "embedding", "siglip"}
    assert set(body["models"].values()) <= {"loaded", "not_loaded"}


def test_der_endpoint():
    ref = [{"start_ms": 0, "end_ms": 1000, "speaker": "A"}]
    r = client.post("/der", json={"reference": ref, "hypothesis": ref})
    assert r.status_code == 200 and r.json()["der"] == 0.0


def test_bad_audio_path_is_400():
    r = client.post("/embed", json={"audio_path": "/nonexistent/x.wav", "segments": [{"start_ms": 0, "end_ms": 500}]})
    assert r.status_code == 400 and r.json()["error"] == "bad_input"
    r = client.post("/diarize", json={"audio_path": "relative.wav"})
    assert r.status_code == 400


def test_embed_endpoint(conversation):
    u = conversation["gold"][0]
    r = client.post("/embed", json={"audio_path": conversation["path"], "segments": [{"start_ms": u["start_ms"], "end_ms": u["end_ms"]}]})
    assert r.status_code == 200
    assert len(r.json()["embeddings"][0]) == 192
    assert client.get("/health").json()["models"]["embedding"] == "loaded"


def test_cli_der(tmp_path):
    ref = [{"start_ms": 0, "end_ms": 1000, "speaker": "A"}, {"start_ms": 1000, "end_ms": 2000, "speaker": "B"}]
    f = tmp_path / "req.json"
    f.write_text(json.dumps({"reference": ref, "hypothesis": ref, "collar_ms": 0}))
    out = subprocess.run([sys.executable, "-m", "audio_sidecar.cli", "der", str(f)], capture_output=True, text=True, check=True)
    assert json.loads(out.stdout)["der"] == 0.0
