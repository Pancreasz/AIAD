# Local ASR via faster-whisper — Design

**Status:** Approved, not yet planned or implemented.

**Goal:** Replace the OpenAI Whisper API as the primary speech-to-text engine with a local `faster-whisper` model running in a Python sidecar, keeping the existing API client as an automatic fallback. No scorer logic changes.

**Context:** Plan 1 (`docs/superpowers/plans/2026-08-13-moca-foundation-voice-subtests.md`) built the test-administration pipeline with the OpenAI Whisper API as the only transcription path. Every voice subtest routes through `transcribe(audioBuffer, mimeType, language)`, so the engine is swappable behind that one seam.

---

## Decisions and Their Reasons

Recording these because several reverse an earlier position, and the reasoning is what makes them re-evaluable later.

**Primary driver: demo robustness.** Not privacy, not cost. This is why the cloud fallback is automatic rather than opt-in, and why each transcript displays which engine produced it.

**faster-whisper, not whisper.cpp.** whisper.cpp was the initial recommendation, on the grounds that bundling Python inside a Windows Electron installer is painful. That objection died once delivery was settled as "run from `npm run dev` on the dev machine" — there is no installer. On the actual target setup faster-whisper wins on every axis that matters:

| | faster-whisper | whisper.cpp |
|---|---|---|
| Binary sourcing | `pip install` | prebuilt Windows binaries or CMake/MSVC build |
| Model fetch | automatic via `huggingface_hub` | manual `.bin` download |
| Audio transcode | none — PyAV decodes webm/opus | needs `ffmpeg-static` (~80 MB); `ffmpeg` is not on this machine's PATH |
| Runtime dep | Python — already installed (Miniconda 3.13.13) | none |

The decisive argument is forward-looking: the Clock Drawing Test model already exists and is a Python model. A Python sidecar is required by this project regardless. Building it here means the CDT subsystem inherits a tested Python bridge instead of inventing a second one, and avoids maintaining a C++ sidecar and a Python sidecar side by side.

**Model: `large-v3-turbo`, not `large-v3`.** The target machine is an i7-10850H (6c/12t, 2020 mobile) with Intel UHD graphics — **no CUDA**, so inference is CPU-only. `large-v3` on that CPU is estimated at 20–40s per 10s answer, which across four subtests is minutes of dead air. `large-v3-turbo` is a distilled-decoder variant: roughly 5x faster decoding, near-identical transcription quality (materially weaker only at translation, which this project does not use). Swapping back is a one-line config change.

CT2 conversion: `deepdml/faster-whisper-large-v3-turbo-ct2`, loaded with `compute_type="int8"`.

**Model delivery: setup script on the dev machine.** Not bundled into an installer, not downloaded on first app launch. The demo runs from `npm run dev` on a known laptop, so a one-time `npm run setup:asr` is the lowest-risk option — no giant installer, and no dependency on venue internet.

---

## Architecture

```
renderer                                     [unchanged]
  SessionRunner → useSubtestSession
        │ window.api.transcribeAudio(buffer, mimeType, 'th')
        ▼
main/ipc/asr.js                              [thin: delegates to router]
        ▼
main/asr/transcriber.js          NEW — engine router + fallback policy
        ├─ tries ──► main/asr/localClient.js     NEW — HTTP → sidecar
        │                   │
        └─ falls back ─► main/asr/whisperClient.js  [unchanged, now the fallback]
                            │
main/asr/sidecarProcess.js       NEW — spawn / health / restart / kill
        │ spawns
        ▼
sidecar/asr_server.py            NEW — FastAPI, holds WhisperModel in memory
```

### Why a resident sidecar

Loading `large-v3-turbo` costs roughly 10–30s. That must happen once at app start, not once per subtest. The server keeps the model in memory; each transcription is a local HTTP POST costing only inference time. Spawning a Python process per request would add the full model-load cost to every answer.

### Startup must not block the window

`sidecarProcess.start()` is fired during `app.whenReady()` and is **not** awaited before `createWindow()`. The window appears immediately while Python boots and loads the model in the background.

This repeats a lesson already paid for once: in Plan 1, `registerAsrHandlers()` built the Whisper client eagerly before `createWindow()`, so a missing API key left the app with no window at all (fixed in commit `e29c718`). Nothing slow or fallible belongs between app start and a visible window.

### The engine boundary

Both clients satisfy the shape `whisperClient` already has:

```js
transcribe(audioBuffer, mimeType, language) → Promise<string>
```

The `engine` label is attached by `transcriber.js`, not by the clients — a client has no business naming itself, and this is what keeps `whisperClient.js` genuinely unchanged rather than "unchanged except for its return type". `transcriber` returns the tagged result:

```js
transcribe(audioBuffer, mimeType, language) → Promise<{ text, engine }>
```

`transcriber.js` consumes two plain clients and knows nothing about Python, HTTP, or OpenAI specifics.

### Interface change

`transcribe` currently resolves to a bare `string`. To surface which engine produced each transcript it must resolve to `{ text, engine }`. This ripples into exactly three places:

- `src/renderer/src/moca/useSubtestSession.js` — destructure instead of assign
- the `results` entries — gain an `engine` field
- `src/renderer/src/pages/SessionResults.jsx` — render an Engine column

No scorer is touched. Of the 37 existing tests, only `useSubtestSession.test.js` and `SessionResults.test.jsx` need updating.

---

## Fallback Policy

**Triggers a fallback (local → OpenAI):** sidecar not running; Python or venv missing; connection refused; HTTP 5xx; malformed response; timeout.

**Does not trigger a fallback:** an empty transcript. If the patient said nothing, that is a legitimate result that scores 0. Retrying against the cloud would spend money to receive the same empty string. Silence is an answer, not a failure. This case has a dedicated test so it is not "fixed" later by someone reading it as a bug.

**Known-dead local is skipped, not waited on.** `sidecarProcess` maintains a readiness flag from health polling. `transcriber` reads that flag in memory *before* attempting a request; if the sidecar is down or still loading, it goes straight to the API rather than burning the timeout rediscovering that. The timeout applies only when local was ready and then stalled.

**Timeout:** 60s, configurable. Generous deliberately — `turbo` on a ≤15s answer should finish well under it, and a premature fallback costs more than a slightly late one.

**No transcription retries.** One local attempt, then the API.

**Process supervision is separate from transcription retries.** `sidecarProcess` polls `/health` every 1s until ready, then every 10s. If the process exits unexpectedly it is marked unavailable immediately and restarted **once**; if the restart also exits, it stays unavailable for the rest of the session and every transcription falls back. A crash loop must not become an endless respawn during a demo.

**Both-failed errors name both causes**, not just the last:

```
Transcription failed.
  local:  sidecar not ready (model still loading)
  openai: OPENAI_API_KEY is not set
```

### Visibility

- `SessionRunner` shows a persistent status line: `ASR: local (ready)` / `local (loading…)` / `cloud fallback` / `unavailable`.
- `SessionResults` gains an **Engine** column naming the engine per transcript.

### Cloud fallback can be disabled

`MOCA_ALLOW_CLOUD_FALLBACK` (default `true`). Demo robustness is the current driver, so the default is on. But a real patient pilot cannot silently ship voice recordings — health data about an identifiable person — to a third party. Set it `false` and a local failure becomes a hard error instead of a cloud call. One boolean now avoids rewriting the policy under time pressure later.

**Demo framing note:** when the cloud fallback fires, audio does leave the machine. The per-transcript Engine column exists partly so this is never invisible.

---

## Configuration

All via the existing `.env` (already gitignored, loaded through `dotenv` in `src/main/index.js`).

| Var | Default | Meaning |
|---|---|---|
| `OPENAI_API_KEY` | *(unset)* | Fallback is unavailable without it |
| `MOCA_ASR_PYTHON` | `python` | Interpreter used by `setup:asr` to build the venv |
| `MOCA_ASR_MODEL` | `deepdml/faster-whisper-large-v3-turbo-ct2` | CT2 model id |
| `MOCA_ASR_PORT` | `0` | `0` = Node picks a free port |
| `MOCA_ASR_TIMEOUT_MS` | `60000` | Local transcription timeout |
| `MOCA_ALLOW_CLOUD_FALLBACK` | `true` | `false` makes local failure a hard error |

---

## Python Sidecar

### Layout

```
sidecar/
  asr_server.py          FastAPI app; holds the model in memory
  requirements.txt       faster-whisper, fastapi, uvicorn[standard], python-multipart
  test_asr_server.py     pytest, model stubbed
  .venv/                 gitignored
scripts/
  setup-asr.mjs          one-shot environment bootstrap
```

### `npm run setup:asr`

1. Locate Python (`MOCA_ASR_PYTHON`, default `python`).
2. Create `sidecar/.venv`.
3. Install `requirements.txt` into it.
4. Pre-download the model by instantiating `WhisperModel` once.

Step 4 matters: the first load pulls roughly 1.6 GB from HuggingFace. That belongs at the desk, not in front of judges.

The script invokes `.venv/Scripts/python.exe` (POSIX: `.venv/bin/python`) directly rather than activating the venv, sidestepping Windows activation-script issues.

### Endpoints

- `GET /health` → `{ status: 'loading' | 'ready' }`
- `POST /transcribe` (multipart: file, language) → `{ text }`, or 503 before the model is ready

The model loads on a background thread at startup so `/health` answers immediately with `loading` rather than hanging. That response is what feeds the readiness flag the fallback policy depends on.

### Port selection happens in Node

Node binds port 0 to find a free port, then passes it explicitly as `--port N`. Letting Python choose leaves the parent with no reliable way to learn the port.

### Testability constraint

`asr_server.py` must reach its model through a loader function that tests can stub, not a module-level constant built at import time. Otherwise importing the module downloads 1.6 GB.

---

## Testing

| Test file | Injected | Covers |
|---|---|---|
| `localClient.test.js` | `fetchImpl` | success, HTTP 5xx, timeout |
| `transcriber.test.js` | both clients + readiness fn | full fallback matrix |
| `sidecarProcess.test.js` | `spawn`, health `fetch`, clock | readiness transitions, crash → one restart, second crash → stays unavailable, kill on quit |
| `test_asr_server.py` | model loader | `/health` loading→ready, `/transcribe` happy path, 503 before ready |
| `useSubtestSession.test.js` | *(updated)* | results carry `engine` |
| `SessionResults.test.jsx` | *(updated)* | Engine column renders |

`transcriber.test.js` carries the most weight — six cases:

1. local ready and succeeds → `engine: 'local'`, API never called
2. local not ready → API called immediately, local never attempted
3. local ready but throws → API called, `engine: 'openai'`
4. local returns empty string → stays local, API never called
5. both fail → error message contains both causes
6. fallback disabled + local fails → throws, API never called

### Commands

- `npm test` — Vitest only, keeps the JS loop fast
- `npm run test:asr` — pytest
- `npm run test:all` — both

### What stays manual

No automated test exercises real inference on real audio. Verifying that Thai transcribes well enough to score correctly requires the real model and a real recording. This is the step that will reveal whether `turbo`'s Thai is accurate enough for digit span, where an exact digit sequence is required and there is no room for a plausible-sounding error.

---

## Also Updated

`.gitignore` gains `sidecar/.venv` and `__pycache__/`.

---

## Out of Scope

- Packaging the Python sidecar into a distributable installer. Delivery is dev-machine-only by decision.
- Replacing the OpenAI client. It stays, as the fallback.
- GPU acceleration. The target machine has no CUDA device.
- Benchmarking Thai accuracy across engines. Worth doing on real pilot recordings, but it needs data that does not exist yet.
- Any scorer change. The scorers consume transcript text and are unaffected.

---

## Known Risks

**`ctranslate2` wheels on Python 3.13.** 3.13 is new enough that wheels can lag. If installation fails, the fix is a conda env pinned to 3.11 — cheap, and conda is already installed. `setup-asr.mjs` should fail with a message saying this rather than a raw pip traceback.

**`turbo`'s Thai accuracy is unmeasured.** Whisper's Thai is materially weaker than its English, and digit span demands exact sequences. If turbo proves insufficient, the escape hatches in order of cost are: switch `MOCA_ASR_MODEL` to full `large-v3` and accept the latency; or evaluate a Thai-specific ASR. The config-driven model id keeps the first option a one-line change.

**Sidecar startup latency vs. an eager operator.** The model takes 10–30s to load. A user who starts the first subtest immediately will hit the cloud fallback. This is correct behavior, and the status line makes it visible.
