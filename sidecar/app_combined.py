import os
import uuid
import logging
from datetime import datetime
import io
import argparse

from fastapi import FastAPI, Request, File, UploadFile, Form, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from starlette.concurrency import run_in_threadpool
from PIL import Image, UnidentifiedImageError
import uvicorn

from cube_scorer import Config as CubeConfig
from cube_scorer import normalize_to_crop, extract_edges, cluster_vertices
from cube_scorer import cluster_orientations, score_cube

from clock_scorer import predict_clock_image
import asr_scorer

# ========================
# CONFIGURATION
# ========================
app = FastAPI(title="Digital MoCA Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

limiter = Limiter(key_func=get_remote_address, default_limits=["20/minute"])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RESIZED_FOLDER = os.path.join(BASE_DIR, "resized_uploads")
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg"}

os.makedirs(RESIZED_FOLDER, exist_ok=True)

logger = logging.getLogger("moca_backend")
logger.setLevel(logging.INFO)
if not logger.handlers:
    ch = logging.StreamHandler()
    logger.addHandler(ch)

def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS

# ========================
# CUBE SCORER
# ========================
cube_config = CubeConfig()

def score_cube_json(data: dict):
    if not isinstance(data, dict):
        raise ValueError("Request body must be a JSON object.")
    if data.get("testId") != "cube":
        raise ValueError("JSON testId must be 'cube'.")
    if "cropBox" not in data:
        raise ValueError("Missing cropBox.")
    if "strokes" not in data or not isinstance(data["strokes"], list):
        raise ValueError("Missing or invalid strokes.")

    strokes = normalize_to_crop(data)
    if not strokes:
        raise ValueError("No valid drawing strokes found.")

    edges = extract_edges(strokes, cube_config)
    vertices = cluster_vertices(edges, cube_config.endpoint_radius)
    groups = cluster_orientations(edges, 3)
    return score_cube(strokes, edges, vertices, cube_config)

# ========================
# ROUTES
# ========================

@app.get("/")
def index():
    return {
        "message": "Digital MoCA backend is running.",
        "endpoints": {
            "clock": "POST /clock",
            "cube": "POST /cube",
            "health": "GET /health",
            "transcribe": "POST /transcribe"
        }
    }

# ------------------------
# CLOCK
# ------------------------
@app.post("/clock")
@limiter.limit("10/minute")
async def clock_endpoint(request: Request, file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file selected.")

    if not allowed_file(file.filename):
        raise HTTPException(status_code=400, detail="Invalid file type.")

    try:
        content = await file.read()
        try:
            image = Image.open(io.BytesIO(content))
            image.verify()
            image = Image.open(io.BytesIO(content)).convert("RGBA")
        except (UnidentifiedImageError, Exception):
            raise HTTPException(status_code=400, detail="Uploaded file is not a valid image.")

        white_bg = Image.new("RGB", image.size, (255, 255, 255))
        mask = image.split()[3] if len(image.split()) > 3 else None
        white_bg.paste(image, mask=mask)
        resized_image = white_bg.resize((224, 224))

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"clock_{timestamp}_{uuid.uuid4().hex[:8]}.jpg"
        filepath = os.path.join(RESIZED_FOLDER, filename)
        resized_image.save(filepath, "JPEG")

        model_path = os.path.join(os.path.dirname(BASE_DIR), "models", "moca_densenet.pth")
        predicted_score = await run_in_threadpool(predict_clock_image, filepath, model_path)

        logger.info(f"Clock processed: {filename} from {request.client.host} score={predicted_score}")

        return {
            "test": "clock",
            "score": predicted_score,
            "predicted_moca_score": predicted_score,
            "filename": filename
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Clock processing failed")
        raise HTTPException(status_code=500, detail=f"Server error while processing clock. details: {str(e)}")

# ------------------------
# CUBE
# ------------------------
@app.post("/cube")
@limiter.limit("10/minute")
async def cube_endpoint(request: Request):
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=415, detail="Expected application/json request body.")

    try:
        result = await run_in_threadpool(score_cube_json, data)
        logger.info(f"Cube processed from {request.client.host}: score={result['score']}, confidence={result['confidence']}")
        return {
            "test": "cube",
            "score": result["score"],
            "confidence": result["confidence"],
            "details": result
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Cube processing failed")
        raise HTTPException(status_code=500, detail=f"Server error while processing cube. details: {str(e)}")

# ------------------------
# ASR
# ------------------------
@app.get("/health")
def asr_health():
    return asr_scorer.get_status()

@app.post("/transcribe")
@limiter.limit("10/minute")
async def asr_transcribe(request: Request, file: UploadFile = File(...), language: str = Form("th")):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file selected.")
        
    model = asr_scorer.get_model()
    if model is None:
        raise HTTPException(status_code=503, detail="model not loaded")
        
    try:
        audio_bytes = await file.read()
        text = await run_in_threadpool(asr_scorer.transcribe_sync, model, audio_bytes, language)
        return {"text": text}
    except Exception as e:
        logger.exception("ASR processing failed")
        raise HTTPException(status_code=500, detail=f"Server error while processing audio. details: {str(e)}")

# ========================
# ENTRY POINT
# ========================
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    asr_scorer.start_loading()

    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")

if __name__ == "__main__":
    main()
