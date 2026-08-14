# Local ASR — Verification Notes and Remaining Manual Steps

Companion to [`2026-08-13-local-asr-faster-whisper.md`](2026-08-13-local-asr-faster-whisper.md)
and its [spec](../specs/2026-08-13-local-asr-faster-whisper-design.md). Written at the end of
implementation so the measured facts survive outside a scratch directory.

**Branch:** `local-asr` · **Head at writing:** `0140333` · Tasks 1–7 complete and reviewed;
final whole-branch review clean after one fix wave. Task 8 is partially complete — see below.

## What was verified automatically

- `npm test` → 69 tests, exit 0
- `npm run test:asr` → 8 tests
- `npm run build` → exit 0

## What was verified against the real model (no microphone needed)

Launched `sidecar/asr_server.py` exactly as the app does and probed it over HTTP:

| Measurement | Result |
|---|---|
| First `/health` answer | 1.5s, returns `{"status":"loading"}` |
| Model ready | 7.6s (the spec estimated 10–30s) |
| `/transcribe` | HTTP 200 with a valid `{"text": ...}` body |
| `/health` immediately after inference | 0.00s |

That last row is the meaningful one: it demonstrates in the assembled system that the
threadpool offload added in Task 1's fix round genuinely keeps `/health` responsive during a
transcription. The readiness flag, and therefore the whole cloud-fallback policy, depends on it.

## Latency — measured, but do not plan around these numbers

| Input | Inference | Ratio |
|---|---|---|
| 3s synthetic tone | 11.9–12.2s (3 runs) | ~4.0× realtime |
| 10s synthetic tone | 30.5–31.9s | ~3.1× realtime |

Tuning attempts on the 10s clip: `beam_size=1` gave no improvement (31.4s vs 30.5s);
`cpu_threads=12` was *worse* (36.0s); `vad_filter=True` returned in 0.5s but only because VAD
correctly detected no speech in a pure tone and skipped the work.

**These figures are probably pessimistic and should not be trusted.** The input was a 440 Hz
tone, not speech. Whisper on non-speech commonly enters repetition/hallucination loops that
decode to the maximum token length — worst case. Real speech usually terminates much earlier.
Real-speech latency is still unknown.

## Remaining manual steps (need a microphone and a person)

From the plan's Task 8. Everything up to here is done.

1. **Local-only run.** Move `.env` aside so no API key is present, `npm run dev`. Confirm the
   window appears immediately, the status line reads `ASR: local engine loading…`, then becomes
   `ASR: local (ready)`. Run one subtest; the results table should show engine `local`.
2. **Cloud fallback.** Restore `.env` with a real `OPENAI_API_KEY`. Start the app and click
   Start *before* the status reaches ready. The answer should still transcribe, with the Engine
   column reading `openai`.
3. **Fallback disabled.** Add `MOCA_ALLOW_CLOUD_FALLBACK=false`, restart, record before ready.
   Expect a visible error naming both causes. (This path had no UI at all until the final fix
   wave added the error state and Retry button — it is worth confirming.)
4. **Full four-subtest session** on the local engine, with `โรงพยาบาลตัวอย่าง` and `กรุงเทพ`
   to match the hardcoded `SESSION_CONTEXT`. Record two things:
   - **Latency per subtest** — the real number that decides whether turbo is fast enough.
   - **Digit span accuracy specifically.** It needs an exact digit sequence and is the least
     forgiving of a plausible-sounding ASR error.
5. **Watch for orphaned Python.** `tasklist | findstr python` after quitting. `electron-vite dev`
   restarts the main process on edits; if a restart skips `will-quit`, a child holding the model
   could be stranded.

## Follow-ups worth considering afterwards

- **`vad_filter=True`** on the `model.transcribe()` call in `sidecar/asr_server.py`. One line.
  Real recordings carry silence before and after the answer, and VAD trims it. Likely the single
  biggest latency win available — but measure real-speech latency first.
- **If turbo's Thai proves inaccurate**, `MOCA_ASR_MODEL` swaps to full `large-v3` in `.env` with
  no code change. Expect it to be slower.
- **`sidecarProcess.js` pipes `child.stdout` but never drains it.** Judged low risk (uvicorn runs
  at `log_level="warning"`, tqdm writes to stderr) and deferred. If the sidecar ever hangs after
  producing output, this is the first place to look — the fix mirrors the existing stderr drain.
- **Status labels** are supervisor states (`loading`/`ready`/`unavailable`/`stopped`), and
  `'unavailable — using cloud fallback'` is inaccurate when fallback is disabled or no API key is
  set. Cosmetic, but this app records patient voice, so the egress indicator should be truthful.

## Environment note

This machine has `SSL_CERT_FILE` set globally to a path that does not exist
(`…\miniconda3/ssl/cacert.pem`). It breaks Python HTTPS. It did not affect the verified runs —
the model is cached and the sidecar makes no network calls — but any future `pip install` or
model change will fail until it is fixed or unset.

Separately: when writing Python probes against the sidecar, use `httpx.Client(trust_env=False)`.
With `trust_env=True`, httpx picked up a Windows registry proxy with no localhost bypass and
could not reach `127.0.0.1`, which produced a convincing false "the sidecar is hung" result.
Node's undici `fetch` does not read system proxy settings, so the app itself is unaffected.
