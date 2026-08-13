"""Local ASR sidecar: holds a faster-whisper model in memory and transcribes over HTTP.

The model is deliberately NOT constructed at import time — tests import this
module, and constructing the model would download ~1.6 GB.
"""

import argparse
import io
import os
import threading

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

DEFAULT_MODEL = "deepdml/faster-whisper-large-v3-turbo-ct2"

app = FastAPI()

_model = None
_load_error = None


def load_model():
    """Construct the model. Monkeypatched in tests so no download happens."""
    from faster_whisper import WhisperModel

    model_id = os.environ.get("MOCA_ASR_MODEL", DEFAULT_MODEL)
    return WhisperModel(model_id, device="cpu", compute_type="int8")


def start_loading():
    """Load the model on a background thread so /health answers immediately."""

    def _work():
        global _model, _load_error
        try:
            _model = load_model()
        except Exception as exc:  # noqa: BLE001 - surfaced verbatim via /health
            _load_error = str(exc)

    thread = threading.Thread(target=_work, daemon=True)
    thread.start()
    return thread


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
    segments, _info = _model.transcribe(audio, language=language)
    return {"text": "".join(segment.text for segment in segments).strip()}


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
