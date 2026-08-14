import asyncio
import io
import threading

from fastapi import UploadFile
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


def test_transcribe_offloads_both_the_model_call_and_the_segment_drain():
    """faster-whisper does nearly all of its CPU work while *iterating* the
    segment generator, not during the transcribe() call itself. Offloading
    only the call and then draining the generator back on the event loop
    would look like a fix while leaving the real blocking work in place, so
    this records the thread each step actually runs on and requires both to
    differ from the event loop's thread.

    This drives asr_server.transcribe() directly via asyncio.run() rather
    than going through TestClient: TestClient runs the whole ASGI app on its
    own anyio "portal" thread regardless of what the handler does, so
    comparing against the pytest thread there would pass vacuously whether
    or not anything is actually offloaded. asyncio.run() puts the event loop
    on *this* thread, so a worker-thread pool offload is the only way the
    model's thread name can come out different.
    """

    class SlowThreadRecordingModel:
        def __init__(self):
            self.call_thread_name = None
            self.drain_thread_name = None

        def transcribe(self, audio, language=None):
            self.call_thread_name = threading.current_thread().name

            def _segments():
                self.drain_thread_name = threading.current_thread().name
                yield FakeSegment(" สิงโต")
                yield FakeSegment(" แรด")

            return _segments(), {}

    model = SlowThreadRecordingModel()
    asr_server._model = model
    main_thread_name = threading.current_thread().name

    upload = UploadFile(io.BytesIO(b"fake-bytes"), filename="audio.webm")
    result = asyncio.run(asr_server.transcribe(file=upload, language="th"))

    assert result == {"text": "สิงโต แรด"}
    assert model.call_thread_name is not None
    assert model.call_thread_name != main_thread_name
    assert model.drain_thread_name is not None
    assert model.drain_thread_name != main_thread_name


def test_start_loading_populates_the_error_slot_when_the_loader_raises(monkeypatch):
    def boom():
        raise RuntimeError("kaboom")

    monkeypatch.setattr(asr_server, "load_model", boom)
    asr_server.start_loading().join(timeout=5)
    assert asr_server._load_error == "kaboom"
