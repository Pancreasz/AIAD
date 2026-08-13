from fastapi.testclient import TestClient

import asr_server


class FakeSegment:
    def __init__(self, text):
        self.text = text


class FakeModel:
    def __init__(self):
        self.calls = []

    def transcribe(self, audio, language=None):
        self.calls.append(language)
        return [FakeSegment(" สิงโต"), FakeSegment(" แรด")], {}


def setup_function():
    asr_server._model = None
    asr_server._load_error = None


def _post_audio(client):
    return client.post(
        "/transcribe",
        files={"file": ("audio.webm", b"fake-bytes", "audio/webm")},
        data={"language": "th"},
    )


def test_health_reports_loading_before_the_model_arrives():
    client = TestClient(asr_server.app)
    assert client.get("/health").json() == {"status": "loading"}


def test_health_reports_ready_once_the_model_is_set():
    asr_server._model = FakeModel()
    client = TestClient(asr_server.app)
    assert client.get("/health").json() == {"status": "ready"}


def test_health_reports_error_when_loading_failed():
    asr_server._load_error = "no wheel for ctranslate2"
    client = TestClient(asr_server.app)
    body = client.get("/health").json()
    assert body["status"] == "error"
    assert body["detail"] == "no wheel for ctranslate2"


def test_transcribe_returns_503_before_the_model_is_ready():
    client = TestClient(asr_server.app)
    assert _post_audio(client).status_code == 503


def test_transcribe_joins_segment_text_and_strips():
    asr_server._model = FakeModel()
    client = TestClient(asr_server.app)
    response = _post_audio(client)
    assert response.status_code == 200
    assert response.json() == {"text": "สิงโต แรด"}


def test_transcribe_passes_the_requested_language_through():
    fake = FakeModel()
    asr_server._model = fake
    client = TestClient(asr_server.app)
    _post_audio(client)
    assert fake.calls == ["th"]


def test_start_loading_populates_the_error_slot_when_the_loader_raises(monkeypatch):
    def boom():
        raise RuntimeError("kaboom")

    monkeypatch.setattr(asr_server, "load_model", boom)
    asr_server.start_loading().join(timeout=5)
    assert asr_server._load_error == "kaboom"
