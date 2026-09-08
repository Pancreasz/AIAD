import os
import threading
import io

DEFAULT_MODEL = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "whisper-th-ct2")

_model = None
_load_error = None

def load_model():
    from faster_whisper import WhisperModel
    model_id = os.environ.get("MOCA_ASR_MODEL", DEFAULT_MODEL)
    return WhisperModel(model_id, device="cpu", compute_type="int8")

def describe_load_failure(exc):
    detail = f"{type(exc).__name__}: {exc}"
    cert = os.environ.get("SSL_CERT_FILE")
    if cert and not os.path.isfile(cert):
        detail += (
            f" | SSL_CERT_FILE points to a file that does not exist: {cert}"
            " -- this breaks HTTPS during model resolution. Relaunch from a"
            " shell that does not carry a stale conda SSL_CERT_FILE."
        )
    return detail

def start_loading():
    def _work():
        global _model, _load_error
        try:
            _model = load_model()
        except Exception as exc:
            _load_error = describe_load_failure(exc)

    thread = threading.Thread(target=_work, daemon=True)
    thread.start()
    return thread

def get_status():
    if _load_error:
        return {"status": "error", "detail": _load_error}
    return {"status": "ready" if _model is not None else "loading"}

def get_model():
    return _model

def transcribe_sync(model, audio_bytes, language):
    audio_file = io.BytesIO(audio_bytes)
    segments, _info = model.transcribe(audio_file, language=language, vad_filter=True)
    return "".join(segment.text for segment in segments).strip()
