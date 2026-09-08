"""Local ASR sidecar: holds a faster-whisper model in memory and transcribes over HTTP.

The model is deliberately NOT constructed at import time — tests import this
module, and constructing the model would download ~1.6 GB.
"""

import argparse
import io
import os
import threading

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from model_paths import resolve_model

DEFAULT_MODEL = "deepdml/faster-whisper-large-v3-turbo-ct2"

app = FastAPI()

_model = None
_load_error = None


def load_model():
    """Construct the model. Monkeypatched in tests so no download happens."""
    from faster_whisper import WhisperModel

    model_id = os.environ.get("MOCA_ASR_MODEL", DEFAULT_MODEL)
    # A raw Transformers checkpoint is converted to CTranslate2 at setup time;
    # resolve_model swaps in that local conversion when one exists, so what we
    # load here matches what prepare_model.py built.
    return WhisperModel(resolve_model(model_id), device="cpu", compute_type="int8")


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


# Constrained decoding for short, isolated clinical answers (digit span,
# serial 7s). With faster-whisper's defaults this fine-tuned Thai model runs
# away on a short clip -- it pads every clip to Whisper's 30s window and keeps
# generating into the trailing silence, repeating the whole answer (a 5-digit
# "21854" came back as "21854 21854 21854 21854") while the 6-step temperature
# fallback re-decodes that runaway six times, taking ~150s and blowing the ASR
# timeout. Measured on the digit stimulus, these four options together bring it
# to a clean "21854" in ~10s, and leave connected speech (memory words, full
# sentences) unchanged:
#   temperature=0            -> one decode pass, not the 6-step fallback storm
#   without_timestamps=True  -> stops generation running on into padded silence
#   condition_on_previous_text=False -> no cross-segment repetition feedback
#   no_repeat_ngram_size=3   -> blocks the verbatim loop outright
DECODE_OPTIONS = dict(
    temperature=0,
    without_timestamps=True,
    condition_on_previous_text=False,
    no_repeat_ngram_size=3,
)


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


# --- Visuospatial drawing scorers -------------------------------------------
#
# The clock and cube tests are scored here, in the same process as ASR, so the
# renderer talks to a single sidecar (see src/main/scoring/drawing.js, which
# POSTs to these two endpoints on the ASR base URL). Torch, Pillow and
# matplotlib are imported lazily inside the endpoints rather than at module
# top: importing this module in tests must stay cheap, and a session that never
# reaches the drawing tests should not pay to load a CNN stack.

# The clock CNN weights live outside the sidecar dir (multi-MB, gitignored
# under models/). Resolved once here so a missing file surfaces as a clear
# error from the endpoint rather than an import-time crash.
CLOCK_MODEL_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "moca_densenet.pth"
)


def _score_cube_json(data):
    """Validate the drawing payload and run the geometric cube scorer.

    Mirrors the field contract the renderer's DrawingTest emits: a JSON object
    carrying testId "cube", a cropBox, and a strokes array.
    """
    from cube_scorer import (
        Config,
        cluster_vertices,
        extract_edges,
        normalize_to_crop,
        score_cube,
    )

    if not isinstance(data, dict):
        raise ValueError("Request body must be a JSON object.")
    if data.get("testId") != "cube":
        raise ValueError("JSON testId must be 'cube'.")
    if "cropBox" not in data:
        raise ValueError("Missing cropBox.")
    if "strokes" not in data or not isinstance(data["strokes"], list):
        raise ValueError("Missing or invalid strokes.")

    cfg = Config()
    strokes = normalize_to_crop(data)
    if not strokes:
        raise ValueError("No valid drawing strokes found.")

    edges = extract_edges(strokes, cfg)
    vertices = cluster_vertices(edges, cfg.endpoint_radius)
    return score_cube(strokes, edges, vertices, cfg)


@app.post("/cube")
async def cube(request: Request):
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=415, detail="Expected a JSON request body.")

    try:
        result = await run_in_threadpool(_score_cube_json, data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001 - reported to the renderer verbatim
        raise HTTPException(status_code=500, detail=f"Cube scoring failed: {exc}")

    # Flatten the scorer's `metrics` up into `details` too, so the renderer's
    # remark string (details.edgesDetected / verticesDetected) reads the values
    # whether it looks at the top level or under metrics.
    details = {**result, **result.get("metrics", {})}
    return {
        "test": "cube",
        "score": result.get("score", 0),
        "confidence": result.get("confidence", 0.0),
        "details": details,
    }


@app.post("/clock")
async def clock(file: UploadFile = File(...)):
    import tempfile

    from PIL import Image, UnidentifiedImageError

    from clock_scorer import predict_clock_image

    if not os.path.isfile(CLOCK_MODEL_PATH):
        raise HTTPException(
            status_code=503,
            detail=f"Clock model weights not found at {CLOCK_MODEL_PATH}",
        )

    content = await file.read()
    try:
        image = Image.open(io.BytesIO(content))
        image.verify()
        image = Image.open(io.BytesIO(content)).convert("RGBA")
    except (UnidentifiedImageError, Exception):
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid image.")

    # Flatten any transparency onto white before handing the CNN a fixed
    # 224x224 RGB frame -- a transparent canvas would otherwise read as black.
    white_bg = Image.new("RGB", image.size, (255, 255, 255))
    mask = image.split()[3] if len(image.split()) > 3 else None
    white_bg.paste(image, mask=mask)
    resized = white_bg.resize((224, 224))

    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        resized.save(tmp_path, "JPEG")
        score = await run_in_threadpool(predict_clock_image, tmp_path, CLOCK_MODEL_PATH)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - reported to the renderer verbatim
        raise HTTPException(status_code=500, detail=f"Clock scoring failed: {exc}")
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    return {"test": "clock", "score": score, "predicted_moca_score": score}


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
