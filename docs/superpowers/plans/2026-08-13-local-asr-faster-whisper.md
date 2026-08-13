# Local ASR via faster-whisper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a local `faster-whisper` model the primary speech-to-text engine, running in a Python sidecar, with the existing OpenAI Whisper API client as an automatic fallback.

**Architecture:** A FastAPI server (`sidecar/asr_server.py`) loads the model once into memory and exposes `/health` and `/transcribe` over localhost HTTP. The Electron main process supervises that server as a child process (`sidecarProcess.js`), talks to it through a plain HTTP client (`localClient.js`), and routes each transcription through a policy module (`transcriber.js`) that falls back to the existing `whisperClient.js` when local is unavailable. The renderer is unchanged except that transcripts now carry which engine produced them.

**Tech Stack:** Python 3.13 (Miniconda, already installed) + faster-whisper + FastAPI + uvicorn; Node/Electron side is existing Vitest. No new npm runtime dependencies — Node's built-in `fetch`, `FormData`, `Blob`, and `child_process` cover everything.

**Spec:** [`docs/superpowers/specs/2026-08-13-local-asr-faster-whisper-design.md`](../specs/2026-08-13-local-asr-faster-whisper-design.md)

## Global Constraints

- Model id: `deepdml/faster-whisper-large-v3-turbo-ct2`, loaded with `device="cpu"`, `compute_type="int8"`. The target machine has no CUDA device.
- Sidecar startup must never be awaited before `createWindow()`. Plan 1 already shipped this bug once (fixed in `e29c718`); do not reintroduce it.
- An empty transcript is a valid result and must NOT trigger the cloud fallback. Silence is an answer.
- Both engine clients expose `transcribe(audioBuffer, mimeType, language) → Promise<string>`. The `engine` label is attached by `transcriber.js`, never by a client.
- `src/main/asr/whisperClient.js` is not modified by any task in this plan.
- No scorer under `src/main/scoring/` is modified by any task in this plan.
- Never commit API keys. `.env` is already gitignored.

---

## File Structure

```
sidecar/
  requirements.txt            (NEW)
  asr_server.py               (NEW — FastAPI app, model held in memory)
  test_asr_server.py          (NEW — pytest, model stubbed)
  .venv/                      (gitignored, created by setup script)
scripts/
  venvPython.mjs              (NEW — shared venv path resolution)
  setup-asr.mjs               (NEW — venv + deps + model pre-download)
  test-asr.mjs                (NEW — pytest runner)
src/main/asr/
  localClient.js              (NEW — HTTP client for the sidecar)
  localClient.test.js         (NEW)
  sidecarProcess.js           (NEW — spawn / health / restart / kill)
  sidecarProcess.test.js      (NEW)
  transcriber.js              (NEW — engine router + fallback policy)
  transcriber.test.js         (NEW)
  whisperClient.js            (UNCHANGED — becomes the fallback)
src/main/ipc/
  asr.js                      (MODIFY — delegate to transcriber, add asr:status)
  asr.test.js                 (MODIFY — rewrite against a fake sidecar)
src/main/
  index.js                    (MODIFY — start/stop the sidecar)
src/preload/
  index.js                    (MODIFY — expose getAsrStatus)
src/renderer/src/moca/
  useSubtestSession.js        (MODIFY — destructure { text, engine })
  useSubtestSession.test.js   (MODIFY)
  SessionRunner.jsx           (MODIFY — ASR status line)
src/renderer/src/pages/
  SessionResults.jsx          (MODIFY — Engine column)
  SessionResults.test.jsx     (MODIFY)
package.json                  (MODIFY — setup:asr, test:asr, test:all)
.gitignore                    (MODIFY — venv, __pycache__, .pytest_cache)
.env.example                  (MODIFY — document the new vars)
```

---

### Task 1: Python sidecar server

**Files:**
- Create: `sidecar/requirements.txt`
- Create: `sidecar/asr_server.py`
- Test: `sidecar/test_asr_server.py`

**Interfaces:**
- Produces: `GET /health` → `{"status": "loading"|"ready"|"error", "detail"?: str}`; `POST /transcribe` (multipart `file`, form `language`) → `{"text": str}` or 503. Consumed by `localClient.js` (Task 3) and `sidecarProcess.js` (Task 4). Also produces the module-level names `app`, `_model`, `_load_error`, `load_model()`, `start_loading()`.

Note: the model is reached through `load_model()` and only ever populated by `start_loading()`. Importing this module must never download 1.6 GB — that is what makes the tests runnable.

- [ ] **Step 1: Create `sidecar/requirements.txt`**

```
faster-whisper>=1.0.3
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
python-multipart>=0.0.9
pytest>=8.0.0
httpx>=0.27.0
```

`httpx` is required by FastAPI's `TestClient`; without it the tests error at import.

- [ ] **Step 2: Write the failing tests**

Create `sidecar/test_asr_server.py`:
```python
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `python -m pytest sidecar -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'asr_server'`.

(If `fastapi` is not installed yet this errors at import instead. Either failure is fine; the implementation step is next. Task 2 builds the venv that makes this command reliable — until then, run it with whatever Python has `fastapi` available, or simply defer this step until after Task 2 and confirm the tests fail by temporarily renaming `asr_server.py`.)

- [ ] **Step 4: Implement `sidecar/asr_server.py`**

Create `sidecar/asr_server.py`:
```python
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest sidecar -q`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add sidecar/requirements.txt sidecar/asr_server.py sidecar/test_asr_server.py
git commit -m "feat: add Python ASR sidecar server"
```

---

### Task 2: Environment setup and npm scripts

**Files:**
- Create: `scripts/venvPython.mjs`
- Create: `scripts/setup-asr.mjs`
- Create: `scripts/test-asr.mjs`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `sidecar/requirements.txt` (Task 1).
- Produces: `venvPython(): string` and `venvExists(): boolean` from `scripts/venvPython.mjs`, used by `setup-asr.mjs`, `test-asr.mjs`, and referenced by `src/main/index.js` (Task 6) to locate the interpreter. Also produces the npm scripts `setup:asr`, `test:asr`, `test:all`.

No unit tests — these are thin process-spawning wrappers whose only real verification is running them, which Step 6 does.

- [ ] **Step 1: Create the shared venv path helper**

Create `scripts/venvPython.mjs`:
```js
import { existsSync } from 'fs'
import { resolve } from 'path'

export const SIDECAR_DIR = resolve('sidecar')
export const VENV_DIR = resolve(SIDECAR_DIR, '.venv')
export const SERVER_SCRIPT = resolve(SIDECAR_DIR, 'asr_server.py')

export function venvPython() {
  return process.platform === 'win32'
    ? resolve(VENV_DIR, 'Scripts', 'python.exe')
    : resolve(VENV_DIR, 'bin', 'python')
}

export function venvExists() {
  return existsSync(venvPython())
}
```

- [ ] **Step 2: Create the setup script**

Create `scripts/setup-asr.mjs`:
```js
import { spawnSync } from 'child_process'
import { resolve } from 'path'
import { SIDECAR_DIR, VENV_DIR, venvPython, venvExists } from './venvPython.mjs'

const basePython = process.env.MOCA_ASR_PYTHON || 'python'
const model = process.env.MOCA_ASR_MODEL || 'deepdml/faster-whisper-large-v3-turbo-ct2'

function run(command, args, label) {
  console.log(`\n> ${label}`)
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) {
    console.error(`\nCould not run ${command}: ${result.error.message}`)
    process.exit(1)
  }
  return result.status ?? 1
}

function runOrExit(command, args, label) {
  const status = run(command, args, label)
  if (status !== 0) process.exit(status)
}

if (venvExists()) {
  console.log(`Reusing existing venv at ${VENV_DIR}`)
} else {
  runOrExit(basePython, ['-m', 'venv', VENV_DIR], `Creating venv at ${VENV_DIR}`)
}

const py = venvPython()
runOrExit(py, ['-m', 'pip', 'install', '--upgrade', 'pip', '--quiet'], 'Upgrading pip')

const installStatus = run(
  py,
  ['-m', 'pip', 'install', '-r', resolve(SIDECAR_DIR, 'requirements.txt')],
  'Installing sidecar requirements'
)
if (installStatus !== 0) {
  console.error(
    [
      '',
      'pip install failed.',
      '',
      'If the error mentions ctranslate2, this Python version has no wheel yet.',
      'Create a 3.11 environment and retry:',
      '',
      '  conda create -n moca-asr python=3.11 -y',
      '  set MOCA_ASR_PYTHON=%USERPROFILE%\\miniconda3\\envs\\moca-asr\\python.exe',
      '  npm run setup:asr',
      ''
    ].join('\n')
  )
  process.exit(installStatus)
}

runOrExit(
  py,
  [
    '-c',
    `from faster_whisper import WhisperModel; WhisperModel(${JSON.stringify(model)}, device="cpu", compute_type="int8"); print("model cached")`
  ],
  `Pre-downloading ${model} (~1.6 GB, one time only)`
)

console.log('\nASR sidecar ready. Run `npm run dev`.')
```

- [ ] **Step 3: Create the pytest runner**

Create `scripts/test-asr.mjs`:
```js
import { spawnSync } from 'child_process'
import { venvPython, venvExists } from './venvPython.mjs'

if (!venvExists()) {
  console.error('No sidecar venv found. Run `npm run setup:asr` first.')
  process.exit(1)
}

const result = spawnSync(venvPython(), ['-m', 'pytest', 'sidecar', '-q'], { stdio: 'inherit' })
process.exit(result.status ?? 1)
```

- [ ] **Step 4: Add the npm scripts**

In the `"scripts"` block of `package.json`, after the existing `"test:watch"` line, add:
```json
    "setup:asr": "node scripts/setup-asr.mjs",
    "test:asr": "node scripts/test-asr.mjs",
    "test:all": "npm test && npm run test:asr",
```

- [ ] **Step 5: Update `.gitignore` and `.env.example`**

Append to `.gitignore`:
```
sidecar/.venv
__pycache__/
.pytest_cache/
```

Replace the contents of `.env.example` with:
```
OPENAI_API_KEY=sk-...

# Interpreter used by `npm run setup:asr` to build sidecar/.venv
MOCA_ASR_PYTHON=python
# CTranslate2 model id for the local engine
MOCA_ASR_MODEL=deepdml/faster-whisper-large-v3-turbo-ct2
# 0 = Node picks a free port
MOCA_ASR_PORT=0
# Local transcription timeout in milliseconds
MOCA_ASR_TIMEOUT_MS=60000
# false = a local failure is a hard error instead of a cloud call
MOCA_ALLOW_CLOUD_FALLBACK=true
```

- [ ] **Step 6: Run setup and verify**

Run: `npm run setup:asr`
Expected: creates `sidecar/.venv`, installs requirements, prints `model cached`, then `ASR sidecar ready.` This downloads ~1.6 GB and will take several minutes on first run.

Then run: `npm run test:asr`
Expected: PASS, 7 tests (the same suite from Task 1, now running in the venv).

If pip fails on `ctranslate2`, follow the conda 3.11 instructions the script prints, then re-run.

- [ ] **Step 7: Commit**

```bash
git add scripts/venvPython.mjs scripts/setup-asr.mjs scripts/test-asr.mjs package.json .gitignore .env.example
git commit -m "feat: add ASR sidecar environment setup and test scripts"
```

---

### Task 3: Local ASR HTTP client

**Files:**
- Create: `src/main/asr/localClient.js`
- Test: `src/main/asr/localClient.test.js`

**Interfaces:**
- Consumes: the sidecar's `POST /transcribe` (Task 1).
- Produces: `createLocalClient({ baseUrl, fetchImpl?, timeoutMs? }): { transcribe(audioBuffer, mimeType, language): Promise<string> }` — used by `transcriber.js` (Task 5) and constructed in `src/main/ipc/asr.js` (Task 6). Returns a bare string, deliberately matching `whisperClient.js`.

- [ ] **Step 1: Write the failing tests**

Create `src/main/asr/localClient.test.js`:
```js
import { describe, it, expect, vi } from 'vitest'
import { createLocalClient } from './localClient.js'

describe('createLocalClient', () => {
  it('throws if no baseUrl is provided', () => {
    expect(() => createLocalClient({})).toThrow('baseUrl is required')
  })

  it('posts the audio to the sidecar and returns the transcript text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'สิงโต แรด อูฐ' })
    })
    const client = createLocalClient({ baseUrl: 'http://127.0.0.1:9999', fetchImpl })

    const result = await client.transcribe(new ArrayBuffer(8), 'audio/webm', 'th')

    expect(result).toBe('สิงโต แรด อูฐ')
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:9999/transcribe',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('throws a descriptive error when the sidecar responds with a non-ok status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'model not loaded'
    })
    const client = createLocalClient({ baseUrl: 'http://127.0.0.1:9999', fetchImpl })

    await expect(client.transcribe(new ArrayBuffer(8), 'audio/webm', 'th')).rejects.toThrow(
      'Local ASR error (503): model not loaded'
    )
  })

  it('reports a timeout distinctly when the request aborts', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    const fetchImpl = vi.fn().mockRejectedValue(abortError)
    const client = createLocalClient({
      baseUrl: 'http://127.0.0.1:9999',
      fetchImpl,
      timeoutMs: 1234
    })

    await expect(client.transcribe(new ArrayBuffer(8), 'audio/webm', 'th')).rejects.toThrow(
      'Local ASR timed out after 1234ms'
    )
  })

  it('reports an unreachable sidecar distinctly from a timeout', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const client = createLocalClient({ baseUrl: 'http://127.0.0.1:9999', fetchImpl })

    await expect(client.transcribe(new ArrayBuffer(8), 'audio/webm', 'th')).rejects.toThrow(
      'Local ASR unreachable: ECONNREFUSED'
    )
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/asr/localClient.test.js`
Expected: FAIL — `localClient.js` doesn't exist yet.

- [ ] **Step 3: Implement `localClient.js`**

Create `src/main/asr/localClient.js`:
```js
export function createLocalClient({ baseUrl, fetchImpl = fetch, timeoutMs = 60000 } = {}) {
  if (!baseUrl) {
    throw new Error('baseUrl is required')
  }

  async function transcribe(audioBuffer, mimeType, language) {
    const extension = mimeType.includes('webm') ? 'webm' : 'wav'
    const form = new FormData()
    form.append('file', new Blob([audioBuffer], { type: mimeType }), `audio.${extension}`)
    form.append('language', language)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let response
    try {
      response = await fetchImpl(`${baseUrl}/transcribe`, {
        method: 'POST',
        body: form,
        signal: controller.signal
      })
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Local ASR timed out after ${timeoutMs}ms`)
      }
      throw new Error(`Local ASR unreachable: ${error.message}`)
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      const detail = await response.text()
      throw new Error(`Local ASR error (${response.status}): ${detail}`)
    }

    const data = await response.json()
    return data.text
  }

  return { transcribe }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/asr/localClient.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/asr/localClient.js src/main/asr/localClient.test.js
git commit -m "feat: add local ASR HTTP client"
```

---

### Task 4: Sidecar process supervisor

**Files:**
- Create: `src/main/asr/sidecarProcess.js`
- Test: `src/main/asr/sidecarProcess.test.js`

**Interfaces:**
- Consumes: `sidecar/asr_server.py` (Task 1), `venvPython()`/`SERVER_SCRIPT` (Task 2) — though the paths are passed in as arguments, not imported here.
- Produces: `createSidecarProcess({ pythonPath, scriptPath, port, spawnImpl?, fetchImpl?, loadingPollMs?, readyPollMs?, maxRestarts? }): { start(), stop(), isReady(): boolean, status(): 'loading'|'ready'|'unavailable'|'stopped', baseUrl(): string }` — used by `src/main/ipc/asr.js` and `src/main/index.js` (Task 6).

Restart policy per the spec: an unexpected exit marks the sidecar unavailable and respawns **once**. A second exit leaves it unavailable for the session. A crash loop must not become an endless respawn.

- [ ] **Step 1: Write the failing tests**

Create `src/main/asr/sidecarProcess.test.js`:
```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { createSidecarProcess } from './sidecarProcess.js'

class FakeChild extends EventEmitter {
  constructor() {
    super()
    this.kill = vi.fn()
    this.stdout = new EventEmitter()
    this.stderr = new EventEmitter()
  }
}

function makeSpawn() {
  const children = []
  const spawnImpl = vi.fn(() => {
    const child = new FakeChild()
    children.push(child)
    return child
  })
  return { spawnImpl, children }
}

function healthReturning(status) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status }) })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createSidecarProcess', () => {
  it('spawns the server with the interpreter, script, and port', () => {
    const { spawnImpl } = makeSpawn()
    const sidecar = createSidecarProcess({
      pythonPath: 'C:/venv/python.exe',
      scriptPath: 'C:/app/asr_server.py',
      port: 8765,
      spawnImpl,
      fetchImpl: healthReturning('loading')
    })

    sidecar.start()

    expect(spawnImpl).toHaveBeenCalledWith(
      'C:/venv/python.exe',
      ['C:/app/asr_server.py', '--port', '8765'],
      expect.anything()
    )
    expect(sidecar.baseUrl()).toBe('http://127.0.0.1:8765')
  })

  it('starts out loading and not ready', () => {
    const { spawnImpl } = makeSpawn()
    const sidecar = createSidecarProcess({
      pythonPath: 'py',
      scriptPath: 's.py',
      port: 1,
      spawnImpl,
      fetchImpl: healthReturning('loading')
    })

    sidecar.start()

    expect(sidecar.isReady()).toBe(false)
    expect(sidecar.status()).toBe('loading')
  })

  it('becomes ready once /health reports ready', async () => {
    const { spawnImpl } = makeSpawn()
    const sidecar = createSidecarProcess({
      pythonPath: 'py',
      scriptPath: 's.py',
      port: 1,
      spawnImpl,
      fetchImpl: healthReturning('ready'),
      loadingPollMs: 1000
    })

    sidecar.start()
    await vi.advanceTimersByTimeAsync(1000)

    expect(sidecar.isReady()).toBe(true)
    expect(sidecar.status()).toBe('ready')
  })

  it('respawns once when the process exits unexpectedly', () => {
    const { spawnImpl, children } = makeSpawn()
    const sidecar = createSidecarProcess({
      pythonPath: 'py',
      scriptPath: 's.py',
      port: 1,
      spawnImpl,
      fetchImpl: healthReturning('loading')
    })

    sidecar.start()
    children[0].emit('exit', 1)

    expect(spawnImpl).toHaveBeenCalledTimes(2)
    expect(sidecar.isReady()).toBe(false)
  })

  it('gives up after a second unexpected exit', () => {
    const { spawnImpl, children } = makeSpawn()
    const sidecar = createSidecarProcess({
      pythonPath: 'py',
      scriptPath: 's.py',
      port: 1,
      spawnImpl,
      fetchImpl: healthReturning('loading')
    })

    sidecar.start()
    children[0].emit('exit', 1)
    children[1].emit('exit', 1)

    expect(spawnImpl).toHaveBeenCalledTimes(2)
    expect(sidecar.status()).toBe('unavailable')
  })

  it('stop() kills the child and does not respawn it', () => {
    const { spawnImpl, children } = makeSpawn()
    const sidecar = createSidecarProcess({
      pythonPath: 'py',
      scriptPath: 's.py',
      port: 1,
      spawnImpl,
      fetchImpl: healthReturning('loading')
    })

    sidecar.start()
    sidecar.stop()
    children[0].emit('exit', 0)

    expect(children[0].kill).toHaveBeenCalled()
    expect(spawnImpl).toHaveBeenCalledTimes(1)
    expect(sidecar.status()).toBe('stopped')
  })

  it('reports unavailable when health polling reports an error status', async () => {
    const { spawnImpl } = makeSpawn()
    const sidecar = createSidecarProcess({
      pythonPath: 'py',
      scriptPath: 's.py',
      port: 1,
      spawnImpl,
      fetchImpl: healthReturning('error'),
      loadingPollMs: 1000
    })

    sidecar.start()
    await vi.advanceTimersByTimeAsync(1000)

    expect(sidecar.status()).toBe('unavailable')
    expect(sidecar.isReady()).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/asr/sidecarProcess.test.js`
Expected: FAIL — `sidecarProcess.js` doesn't exist yet.

- [ ] **Step 3: Implement `sidecarProcess.js`**

Create `src/main/asr/sidecarProcess.js`:
```js
import { spawn as nodeSpawn } from 'child_process'

export function createSidecarProcess({
  pythonPath,
  scriptPath,
  port,
  spawnImpl = nodeSpawn,
  fetchImpl = fetch,
  loadingPollMs = 1000,
  readyPollMs = 10000,
  maxRestarts = 1,
  logger = console
}) {
  const baseUrl = `http://127.0.0.1:${port}`

  let child = null
  let ready = false
  let stopped = false
  let failed = false
  let restarts = 0
  let timer = null

  function spawnChild() {
    child = spawnImpl(pythonPath, [scriptPath, '--port', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    child.stderr?.on('data', (data) => logger.error(`[asr-sidecar] ${data}`))

    child.on('error', (error) => {
      logger.error(`[asr-sidecar] failed to spawn: ${error.message}`)
      ready = false
      failed = true
    })

    child.on('exit', (code) => {
      ready = false
      if (stopped) return

      if (restarts < maxRestarts) {
        restarts += 1
        logger.error(`[asr-sidecar] exited (${code}); restarting once`)
        spawnChild()
      } else {
        failed = true
        logger.error(`[asr-sidecar] exited (${code}) again; giving up for this session`)
      }
    })
  }

  async function poll() {
    if (stopped) return

    try {
      const response = await fetchImpl(`${baseUrl}/health`)
      const body = await response.json()
      if (body.status === 'ready') {
        ready = true
        failed = false
      } else if (body.status === 'error') {
        ready = false
        failed = true
      } else {
        ready = false
      }
    } catch {
      // Sidecar not listening yet; stay in the current state and poll again.
      ready = false
    }

    if (!stopped) {
      timer = setTimeout(poll, ready ? readyPollMs : loadingPollMs)
    }
  }

  function start() {
    stopped = false
    failed = false
    restarts = 0
    spawnChild()
    timer = setTimeout(poll, loadingPollMs)
  }

  function stop() {
    stopped = true
    ready = false
    if (timer) clearTimeout(timer)
    timer = null
    if (child) child.kill()
  }

  function isReady() {
    return ready && !stopped
  }

  function status() {
    if (stopped) return 'stopped'
    if (ready) return 'ready'
    if (failed) return 'unavailable'
    return 'loading'
  }

  return { start, stop, isReady, status, baseUrl: () => baseUrl }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/asr/sidecarProcess.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/asr/sidecarProcess.js src/main/asr/sidecarProcess.test.js
git commit -m "feat: add ASR sidecar process supervisor"
```

---

### Task 5: Engine router and fallback policy

**Files:**
- Create: `src/main/asr/transcriber.js`
- Test: `src/main/asr/transcriber.test.js`

**Interfaces:**
- Consumes: any client shaped like `createLocalClient` (Task 3) or `createWhisperClient` (existing), i.e. `{ transcribe(audioBuffer, mimeType, language): Promise<string> }`; plus `isLocalReady()` from `sidecarProcess.isReady` (Task 4).
- Produces: `createTranscriber({ localClient, apiClient, isLocalReady, allowCloudFallback? }): { transcribe(audioBuffer, mimeType, language): Promise<{ text: string, engine: 'local'|'openai' }> }` — used by `src/main/ipc/asr.js` (Task 6).

`apiClient` may be `null` when `OPENAI_API_KEY` is unset. This is the module that owns the empty-transcript rule.

- [ ] **Step 1: Write the failing tests**

Create `src/main/asr/transcriber.test.js`:
```js
import { describe, it, expect, vi } from 'vitest'
import { createTranscriber } from './transcriber.js'

const BUFFER = new ArrayBuffer(8)

function clients({ localResult, localError, apiResult, apiError } = {}) {
  const localClient = {
    transcribe: vi.fn(() =>
      localError ? Promise.reject(new Error(localError)) : Promise.resolve(localResult)
    )
  }
  const apiClient = {
    transcribe: vi.fn(() =>
      apiError ? Promise.reject(new Error(apiError)) : Promise.resolve(apiResult)
    )
  }
  return { localClient, apiClient }
}

describe('createTranscriber', () => {
  it('uses the local engine when it is ready and succeeds', async () => {
    const { localClient, apiClient } = clients({ localResult: 'สิงโต' })
    const transcriber = createTranscriber({
      localClient,
      apiClient,
      isLocalReady: () => true
    })

    const result = await transcriber.transcribe(BUFFER, 'audio/webm', 'th')

    expect(result).toEqual({ text: 'สิงโต', engine: 'local' })
    expect(apiClient.transcribe).not.toHaveBeenCalled()
  })

  it('skips local entirely when the sidecar is not ready', async () => {
    const { localClient, apiClient } = clients({ apiResult: 'แรด' })
    const transcriber = createTranscriber({
      localClient,
      apiClient,
      isLocalReady: () => false
    })

    const result = await transcriber.transcribe(BUFFER, 'audio/webm', 'th')

    expect(result).toEqual({ text: 'แรด', engine: 'openai' })
    expect(localClient.transcribe).not.toHaveBeenCalled()
  })

  it('falls back to the API when a ready local engine throws', async () => {
    const { localClient, apiClient } = clients({ localError: 'boom', apiResult: 'อูฐ' })
    const transcriber = createTranscriber({
      localClient,
      apiClient,
      isLocalReady: () => true
    })

    const result = await transcriber.transcribe(BUFFER, 'audio/webm', 'th')

    expect(result).toEqual({ text: 'อูฐ', engine: 'openai' })
    expect(localClient.transcribe).toHaveBeenCalled()
  })

  it('does NOT fall back when the local engine returns an empty transcript', async () => {
    const { localClient, apiClient } = clients({ localResult: '' })
    const transcriber = createTranscriber({
      localClient,
      apiClient,
      isLocalReady: () => true
    })

    const result = await transcriber.transcribe(BUFFER, 'audio/webm', 'th')

    expect(result).toEqual({ text: '', engine: 'local' })
    expect(apiClient.transcribe).not.toHaveBeenCalled()
  })

  it('reports both causes when local and the API both fail', async () => {
    const { localClient, apiClient } = clients({ localError: 'sidecar died', apiError: 'HTTP 401' })
    const transcriber = createTranscriber({
      localClient,
      apiClient,
      isLocalReady: () => true
    })

    const error = await transcriber.transcribe(BUFFER, 'audio/webm', 'th').catch((e) => e)

    expect(error.message).toContain('sidecar died')
    expect(error.message).toContain('HTTP 401')
  })

  it('reports a missing API key as the fallback cause when apiClient is null', async () => {
    const { localClient } = clients({ localError: 'sidecar died' })
    const transcriber = createTranscriber({
      localClient,
      apiClient: null,
      isLocalReady: () => true
    })

    const error = await transcriber.transcribe(BUFFER, 'audio/webm', 'th').catch((e) => e)

    expect(error.message).toContain('OPENAI_API_KEY is not set')
  })

  it('never calls the API when cloud fallback is disabled', async () => {
    const { localClient, apiClient } = clients({ localError: 'sidecar died' })
    const transcriber = createTranscriber({
      localClient,
      apiClient,
      isLocalReady: () => true,
      allowCloudFallback: false
    })

    const error = await transcriber.transcribe(BUFFER, 'audio/webm', 'th').catch((e) => e)

    expect(apiClient.transcribe).not.toHaveBeenCalled()
    expect(error.message).toContain('cloud fallback disabled')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/asr/transcriber.test.js`
Expected: FAIL — `transcriber.js` doesn't exist yet.

- [ ] **Step 3: Implement `transcriber.js`**

Create `src/main/asr/transcriber.js`:
```js
function failure(localCause, apiCause) {
  return new Error(
    `Transcription failed.\n  local:  ${localCause}\n  openai: ${apiCause}`
  )
}

export function createTranscriber({
  localClient,
  apiClient,
  isLocalReady,
  allowCloudFallback = true
}) {
  async function transcribe(audioBuffer, mimeType, language) {
    let localCause

    if (isLocalReady()) {
      try {
        // An empty string is a legitimate result (the patient said nothing) and
        // returns here rather than falling through to the cloud.
        const text = await localClient.transcribe(audioBuffer, mimeType, language)
        return { text, engine: 'local' }
      } catch (error) {
        localCause = error.message
      }
    } else {
      localCause = 'sidecar not ready'
    }

    if (!allowCloudFallback) {
      throw failure(localCause, 'cloud fallback disabled (MOCA_ALLOW_CLOUD_FALLBACK=false)')
    }

    if (!apiClient) {
      throw failure(localCause, 'OPENAI_API_KEY is not set')
    }

    try {
      const text = await apiClient.transcribe(audioBuffer, mimeType, language)
      return { text, engine: 'openai' }
    } catch (error) {
      throw failure(localCause, error.message)
    }
  }

  return { transcribe }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/asr/transcriber.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/asr/transcriber.js src/main/asr/transcriber.test.js
git commit -m "feat: add ASR engine router with cloud fallback policy"
```

---

### Task 6: Wire the sidecar into main and IPC

**Files:**
- Modify: `src/main/ipc/asr.js`
- Modify: `src/main/ipc/asr.test.js`
- Modify: `src/main/index.js`
- Modify: `src/preload/index.js`

**Interfaces:**
- Consumes: `createSidecarProcess` (Task 4), `createTranscriber` (Task 5), `createLocalClient` (Task 3), `createWhisperClient` (existing), `venvPython`/`SERVER_SCRIPT` (Task 2).
- Produces: `registerAsrHandlers(sidecar)` — now takes the sidecar as a parameter; renderer-visible `window.api.getAsrStatus(): Promise<string>` alongside the existing `transcribeAudio`/`scoreItem`.

`window.api.transcribeAudio` now resolves `{ text, engine }` instead of a string. Task 7 updates the renderer to match.

- [ ] **Step 1: Rewrite the ASR IPC handler**

Replace the full contents of `src/main/ipc/asr.js`:
```js
import { ipcMain } from 'electron'
import { createWhisperClient } from '../asr/whisperClient.js'
import { createLocalClient } from '../asr/localClient.js'
import { createTranscriber } from '../asr/transcriber.js'

export function registerAsrHandlers(sidecar) {
  // The API client is resolved once and memoized (constructing it reads the
  // env var and can throw). The local client is rebuilt per call so it always
  // reads the sidecar's CURRENT baseUrl -- the port is assigned asynchronously
  // at startup, so caching a URL captured on the first call could pin a stale one.
  let apiClient
  let apiClientResolved = false

  function getApiClient() {
    if (apiClientResolved) return apiClient
    apiClientResolved = true
    try {
      apiClient = createWhisperClient()
    } catch {
      // No OPENAI_API_KEY. Local-only; the transcriber reports this if local fails.
      apiClient = null
    }
    return apiClient
  }

  ipcMain.handle('asr:transcribe', async (_event, { audioBuffer, mimeType, language }) => {
    const transcriber = createTranscriber({
      localClient: createLocalClient({
        baseUrl: sidecar.baseUrl(),
        timeoutMs: Number(process.env.MOCA_ASR_TIMEOUT_MS || 60000)
      }),
      apiClient: getApiClient(),
      isLocalReady: () => sidecar.isReady(),
      allowCloudFallback: process.env.MOCA_ALLOW_CLOUD_FALLBACK !== 'false'
    })

    return transcriber.transcribe(audioBuffer, mimeType, language)
  })

  ipcMain.handle('asr:status', async () => sidecar.status())
}
```

- [ ] **Step 2: Rewrite the IPC handler tests**

Replace the full contents of `src/main/ipc/asr.test.js`:
```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers = new Map()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel, handler) => handlers.set(channel, handler)
  }
}))

const { registerAsrHandlers } = await import('./asr.js')

function fakeSidecar({ ready = false, status = 'loading' } = {}) {
  return {
    isReady: () => ready,
    status: () => status,
    baseUrl: () => 'http://127.0.0.1:9999'
  }
}

const PAYLOAD = { audioBuffer: new ArrayBuffer(8), mimeType: 'audio/webm', language: 'th' }

describe('registerAsrHandlers', () => {
  beforeEach(() => {
    handlers.clear()
    delete process.env.OPENAI_API_KEY
    delete process.env.MOCA_ALLOW_CLOUD_FALLBACK
  })

  it('registers both channels without throwing when nothing is configured', () => {
    expect(() => registerAsrHandlers(fakeSidecar())).not.toThrow()
    expect(handlers.has('asr:transcribe')).toBe(true)
    expect(handlers.has('asr:status')).toBe(true)
  })

  it('reports the sidecar status through asr:status', async () => {
    registerAsrHandlers(fakeSidecar({ status: 'ready' }))
    await expect(handlers.get('asr:status')({})).resolves.toBe('ready')
  })

  it('surfaces both failure causes when local is down and no API key is set', async () => {
    registerAsrHandlers(fakeSidecar({ ready: false }))
    await expect(handlers.get('asr:transcribe')({}, PAYLOAD)).rejects.toThrow(
      'OPENAI_API_KEY is not set'
    )
  })
})
```

- [ ] **Step 3: Run the IPC tests**

Run: `npx vitest run src/main/ipc/asr.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 4: Start and stop the sidecar in the main process**

In `src/main/index.js`, add these imports after the existing `registerScoringHandlers` import:
```js
import { createServer } from 'net'
import { createSidecarProcess } from './asr/sidecarProcess.js'
import { venvPython, SERVER_SCRIPT } from '../../scripts/venvPython.mjs'
```

Then add this helper above `function createWindow() {`:
```js
function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

let sidecar = null

async function startSidecar() {
  const configured = Number(process.env.MOCA_ASR_PORT || 0)
  const port = configured > 0 ? configured : await findFreePort()
  sidecar = createSidecarProcess({
    pythonPath: venvPython(),
    scriptPath: SERVER_SCRIPT,
    port
  })
  sidecar.start()
  return sidecar
}
```

Replace this block inside `app.whenReady().then(() => { ... })`:
```js
  registerAsrHandlers()
  registerScoringHandlers()

  createWindow()
```
with:
```js
  // Deliberately NOT awaited: the window must appear while Python loads the
  // model in the background. See the spec's "Startup must not block the window".
  const pendingSidecar = startSidecar()

  registerAsrHandlers({
    isReady: () => (sidecar ? sidecar.isReady() : false),
    status: () => (sidecar ? sidecar.status() : 'loading'),
    baseUrl: () => (sidecar ? sidecar.baseUrl() : 'http://127.0.0.1:0')
  })
  registerScoringHandlers()

  pendingSidecar.catch((error) => console.error(`[asr-sidecar] ${error.message}`))

  createWindow()
```

Finally, add this before the existing `app.on('window-all-closed', ...)` block:
```js
app.on('will-quit', () => {
  if (sidecar) sidecar.stop()
})
```

- [ ] **Step 5: Expose the status channel through preload**

In `src/preload/index.js`, add a third entry to the `api` object:
```js
  getAsrStatus: () => ipcRenderer.invoke('asr:status')
```

so the object reads:
```js
const api = {
  transcribeAudio: (audioBuffer, mimeType, language) =>
    ipcRenderer.invoke('asr:transcribe', { audioBuffer, mimeType, language }),
  scoreItem: (subtestId, transcript, context) =>
    ipcRenderer.invoke('scoring:score-item', { subtestId, transcript, context }),
  getAsrStatus: () => ipcRenderer.invoke('asr:status')
}
```

- [ ] **Step 6: Verify the app still builds**

Run: `npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc/asr.js src/main/ipc/asr.test.js src/main/index.js src/preload/index.js
git commit -m "feat: supervise the ASR sidecar from the main process"
```

---

### Task 7: Surface the engine in the renderer

**Files:**
- Modify: `src/renderer/src/moca/useSubtestSession.js`
- Modify: `src/renderer/src/moca/useSubtestSession.test.js`
- Modify: `src/renderer/src/pages/SessionResults.jsx`
- Modify: `src/renderer/src/pages/SessionResults.test.jsx`
- Modify: `src/renderer/src/moca/SessionRunner.jsx`

**Interfaces:**
- Consumes: `window.api.transcribeAudio` now resolving `{ text, engine }` and `window.api.getAsrStatus()` (Task 6).
- Produces: `results` entries gain an `engine` field; `SessionResults` renders an Engine column. No further task consumes these.

- [ ] **Step 1: Update the session hook tests**

In `src/renderer/src/moca/useSubtestSession.test.js`, change the `transcribeAudio` mock inside `setup()` from:
```js
  const transcribeAudio = vi.fn().mockResolvedValue('สิงโต แรด อูฐ')
```
to:
```js
  const transcribeAudio = vi.fn().mockResolvedValue({ text: 'สิงโต แรด อูฐ', engine: 'local' })
```

Then, in the test named `'advances to the next subtest after recording and scoring finish'`, change the final assertion from:
```js
    expect(result.current.results[0]).toMatchObject({ subtestId: 'naming', score: 3, maxScore: 3 })
```
to:
```js
    expect(result.current.results[0]).toMatchObject({
      subtestId: 'naming',
      score: 3,
      maxScore: 3,
      engine: 'local'
    })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/moca/useSubtestSession.test.js`
Expected: FAIL — the hook still treats the resolved value as a string, so `results[0].engine` is undefined and the scorer receives an object instead of a transcript.

- [ ] **Step 3: Update the hook**

In `src/renderer/src/moca/useSubtestSession.js`, inside `finishRecording`, change:
```js
    const transcript = await transcribeAudio(audioBuffer, blob.type, 'th')
```
to:
```js
    const { text: transcript, engine } = await transcribeAudio(audioBuffer, blob.type, 'th')
```

and change:
```js
    setResults((prev) => [...prev, { subtestId: currentSubtest.id, transcript, ...scoreResult }])
```
to:
```js
    setResults((prev) => [
      ...prev,
      { subtestId: currentSubtest.id, transcript, engine, ...scoreResult }
    ])
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/moca/useSubtestSession.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Update the results-table test**

Replace the full contents of `src/renderer/src/pages/SessionResults.test.jsx`:
```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SessionResults } from './SessionResults.jsx'

const subtests = [
  { id: 'naming', section: 'Naming' },
  { id: 'orientation', section: 'Orientation' }
]

describe('SessionResults', () => {
  it('renders each subtest score and the total', () => {
    const results = [
      { subtestId: 'naming', score: 2, maxScore: 3, engine: 'local' },
      { subtestId: 'orientation', score: 6, maxScore: 6, engine: 'openai' }
    ]
    render(<SessionResults results={results} subtests={subtests} />)

    expect(screen.getByText('Naming')).toBeInTheDocument()
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    expect(screen.getByText('Orientation')).toBeInTheDocument()
    expect(screen.getByText('6 / 6')).toBeInTheDocument()
    expect(screen.getByText('Total: 8 / 9')).toBeInTheDocument()
  })

  it('names the engine that produced each transcript', () => {
    const results = [
      { subtestId: 'naming', score: 2, maxScore: 3, engine: 'local' },
      { subtestId: 'orientation', score: 6, maxScore: 6, engine: 'openai' }
    ]
    render(<SessionResults results={results} subtests={subtests} />)

    expect(screen.getByText('local')).toBeInTheDocument()
    expect(screen.getByText('openai')).toBeInTheDocument()
  })

  it('falls back to a dash when a result carries no engine', () => {
    const results = [{ subtestId: 'naming', score: 1, maxScore: 3 }]
    render(<SessionResults results={results} subtests={subtests} />)

    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/pages/SessionResults.test.jsx`
Expected: FAIL — no Engine column is rendered yet.

- [ ] **Step 7: Add the Engine column**

In `src/renderer/src/pages/SessionResults.jsx`, change the header row from:
```jsx
          <tr>
            <th>Subtest</th>
            <th>Score</th>
          </tr>
```
to:
```jsx
          <tr>
            <th>Subtest</th>
            <th>Score</th>
            <th>Engine</th>
          </tr>
```

and change the body row from:
```jsx
              <tr key={r.subtestId}>
                <td>{subtest ? subtest.section : r.subtestId}</td>
                <td>
                  {r.score} / {r.maxScore}
                </td>
              </tr>
```
to:
```jsx
              <tr key={r.subtestId}>
                <td>{subtest ? subtest.section : r.subtestId}</td>
                <td>
                  {r.score} / {r.maxScore}
                </td>
                <td>{r.engine ?? '—'}</td>
              </tr>
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/pages/SessionResults.test.jsx`
Expected: PASS, 3 tests.

- [ ] **Step 9: Add the ASR status line to `SessionRunner`**

`SessionRunner.jsx` currently imports no React hooks, so add this as a new first line of the file:
```jsx
import { useEffect, useState } from 'react'
```

Add this hook immediately after the `useSubtestSession(...)` call:
```jsx
  const [asrStatus, setAsrStatus] = useState('loading')

  useEffect(() => {
    let cancelled = false
    const read = async () => {
      const status = await window.api.getAsrStatus()
      if (!cancelled) setAsrStatus(status)
    }
    read()
    const interval = setInterval(read, 2000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])
```

Add this constant above `export function SessionRunner() {`:
```jsx
const ASR_LABELS = {
  loading: 'local engine loading…',
  ready: 'local (ready)',
  unavailable: 'unavailable — using cloud fallback',
  stopped: 'stopped'
}
```

Finally, add the status line as the first child of the returned `<div className="session-runner">`, immediately before the `<h2>`:
```jsx
      <p className="asr-status">ASR: {ASR_LABELS[asrStatus] ?? asrStatus}</p>
```

- [ ] **Step 10: Run the full suite and build**

Run: `npm test`
Expected: all tests PASS.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 11: Commit**

```bash
git add src/renderer/src/moca/useSubtestSession.js src/renderer/src/moca/useSubtestSession.test.js src/renderer/src/pages/SessionResults.jsx src/renderer/src/pages/SessionResults.test.jsx src/renderer/src/moca/SessionRunner.jsx
git commit -m "feat: surface the transcription engine in the session UI"
```

---

### Task 8: End-to-end manual verification

**Files:** none — this task changes no code.

**Interfaces:** none.

This is the only step that exercises real inference on real audio. Everything before it is mocked at an injected seam, so this is where you learn whether `large-v3-turbo` transcribes Thai well enough to score correctly.

- [ ] **Step 1: Confirm the automated suites are green**

Run: `npm run test:all`
Expected: Vitest passes, then pytest passes.

- [ ] **Step 2: Verify local-only operation**

Temporarily rename `.env` to `.env.bak` so no API key is present, then run `npm run dev`.

Confirm, in order:
1. The window appears **immediately** — it must not wait for the model to load.
2. The status line reads `ASR: local engine loading…` at first.
3. Within roughly 10–30 seconds it changes to `ASR: local (ready)`.
4. Run one subtest end to end. The transcript scores, and the results table shows engine `local`.

- [ ] **Step 3: Verify the cloud fallback**

Restore `.env` (with a real `OPENAI_API_KEY`). Start `npm run dev` and immediately click Start on the first subtest, before the status line reaches `ready`.

Expected: the answer still transcribes, and that row's Engine column reads `openai`. This is the fallback doing its job.

- [ ] **Step 4: Verify fallback can be disabled**

Add `MOCA_ALLOW_CLOUD_FALLBACK=false` to `.env`, restart, and again record before the model is ready.

Expected: a visible error mentioning `cloud fallback disabled` rather than a cloud call.

Remove the line afterwards.

- [ ] **Step 5: Run the full four-subtest session on the local engine**

Wait for `ASR: local (ready)`, then complete all four subtests: Naming, Digit Span forward, Digit Span backward, Orientation (with `โรงพยาบาลตัวอย่าง` and `กรุงเทพ` to match the hardcoded `SESSION_CONTEXT`).

Record two things for the project's own benefit:
- **Latency** per subtest — how long "Scoring..." is on screen. This is the number that decides whether `turbo` is fast enough or whether the demo needs a different model.
- **Digit span accuracy specifically.** It demands an exact digit sequence and is the least forgiving of a plausible-sounding ASR error. If it misfires repeatedly, the spec's escape hatch is to set `MOCA_ASR_MODEL` to the full `large-v3` and accept the added latency.

- [ ] **Step 6: Commit any findings**

If the run surfaces a needed config change (for example a different `MOCA_ASR_MODEL` or a longer `MOCA_ASR_TIMEOUT_MS`), update `.env.example` to document it and commit:

```bash
git add .env.example
git commit -m "docs: record ASR settings validated in manual testing"
```

If nothing changed, there is nothing to commit and this task ends here.

---

## What's Deliberately Out of Scope

Per the spec's "Out of Scope" section:

- Packaging the Python sidecar into a distributable installer. Delivery is dev-machine-only by decision.
- Replacing or modifying `whisperClient.js`. It stays exactly as it is, as the fallback.
- GPU acceleration. The target machine has no CUDA device.
- Benchmarking Thai accuracy across engines. Worth doing on real pilot recordings, which do not exist yet.
- Any scorer change. Scorers consume transcript text and are unaffected.
