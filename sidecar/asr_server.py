"""Local ASR sidecar: holds a faster-whisper model in memory and transcribes over HTTP.

The model is deliberately NOT constructed at import time — tests import this
module, and constructing the model would download ~1.6 GB.
"""

import argparse
import io
import os
import threading

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

DEFAULT_MODEL = "deepdml/faster-whisper-large-v3-turbo-ct2"

app = FastAPI()

_model = None
_load_error = None


def load_model():
    """Construct the model. Monkeypatched in tests so no download happens."""
    from faster_whisper import WhisperModel

    model_id = os.environ.get("MOCA_ASR_MODEL", DEFAULT_MODEL)
    return WhisperModel(model_id, device="cpu", compute_type="int8")


def describe_load_failure(exc):
    """Turn a load exception into something diagnosable from /health alone.

    A bare `str(exc)` loses too much: a stale SSL_CERT_FILE surfaces only as
    "[Errno 2] No such file or directory" with no filename, which cost real
    debugging time twice. Name the likely cause when we can detect it.
    """
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
    """Load the model on a background thread so /health answers immediately."""

    def _work():
        global _model, _load_error
        try:
            _model = load_model()
        except Exception as exc:  # noqa: BLE001 - surfaced verbatim via /health
            _load_error = describe_load_failure(exc)

    thread = threading.Thread(target=_work, daemon=True)
    thread.start()
    return thread


def _transcribe_sync(model, audio, language):
    """Run the model and drain its lazy segment generator, off the event loop.

    vad_filter=True skips silent regions instead of decoding them. Without
    it, faster-whisper on CPU can enter a repetition/hallucination loop on
    silence and decode to the maximum token length -- measured at 53s for a
    10s pure-silence clip, against this app's 60s hard transcription timeout.
    With it, the same clip returns in 0.6s.
    """
    segments, _info = model.transcribe(audio, language=language, vad_filter=True)
    return "".join(segment.text for segment in segments).strip()


@app.get("/health")
def health():
    if _load_error:
        return {"status": "error", "detail": _load_error}
    return {"status": "ready" if _model is not None else "loading"}


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...), language: str = Form("th")):
    if _model is None:
        raise HTTPException(status_code=503, detail="model not loaded")

    audio = io.BytesIO(await file.read())
    text = await run_in_threadpool(_transcribe_sync, _model, audio, language)
    return {"text": text}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    start_loading()

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
