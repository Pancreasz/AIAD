# Digital MoCA — Handout

Continuing this project in a new Claude Code session? Start here.

*Last updated 2026-08-16, after Serial 7s and Vigilance subtests landed.*

## What this project is

Digitizing the Thai MoCA-Basic (Montreal Cognitive Assessment) so it can be self-administered
without a clinician present: a patient writes with a real pen on real paper clipped to a smart
pad, and speaks answers into a mic, while the app scores everything automatically and captures
process data (handwriting kinematics, speech timing) that a paper test can't. Built for an
innovation competition, <1 month timeline starting 2026-08-13.

## Current state

**8 of 13 subtests, 22 of 30 points.** 219 JS tests + 10 Python tests, all passing, build clean.
Everything is merged to `main` and pushed to `origin`. Working tree clean.

| Built | Points | Notes |
|---|---|---|
| Naming | 3 | 3 animal images displayed |
| Digit Span (fwd + bwd) | 2 | stimulus audio plays before the mic opens |
| Memory registration ×2 | 0 | MoCA scores these 0; recalled count captured as process data |
| Delayed Recall | 5 | scored unscorable if registration was skipped |
| Orientation | 6 | Buddhist Era year |
| Serial 7s | 3 | scored on the non-linear band table, against what the patient said |
| Vigilance | 1 | 29 digits at 1/sec, tap on 1 — the only non-voice subtest |
| Abstraction ×2 | 2 | accept-list only; a reject-list would strip correct answers |

**Not built (5 subtests, 8 points):** sentence repetition (2), verbal fluency (1) — 3 voice
points. Plus Trail Making (1), Cube copy (1), Clock Drawing (3) — **the pen/Wacom subtests are
being done by the user's teammates, not here.**

The session now runs **eleven screens**: Memory registration and Digit Span contribute two each,
and Abstraction two, so screens outnumber MoCA subtests.

### Architecture as built

- **Electron + React**, JS not TypeScript (deliberately — a TS migration was considered and
  declined on timeline grounds).
- **Speech-to-text runs locally.** A Python sidecar (`sidecar/asr_server.py`, FastAPI) holds
  `faster-whisper large-v3-turbo` in memory and serves `/health` and `/transcribe` on localhost.
  The Electron main process spawns and supervises it. The OpenAI Whisper API remains an
  automatic fallback but is **not currently reachable** — there is no `.env`, so no API key.
- **Scoring is rule-based and deterministic**, in `src/main/scoring/`. No ML model anywhere in
  this repo. (The team's Clock Drawing model is separate and not yet integrated.)
- **Session pipeline:** `useSubtestSession` drives instruction → stimulus audio → record →
  transcribe → score → advance. Every dependency is injected, so tests never touch a real mic,
  real audio, or the network.

### Read these if you need depth

| Doc | What it covers |
|---|---|
| `docs/superpowers/specs/2026-08-13-local-asr-faster-whisper-design.md` | Why local ASR, why a sidecar, the fallback policy |
| `docs/superpowers/specs/2026-08-15-memory-delayed-recall-design.md` | Memory subtest, stimulus audio, Skip semantics |
| `docs/superpowers/plans/2026-08-15-local-asr-verification-notes.md` | Measured sidecar numbers and remaining manual steps |
| `docs/moca-audio-recording-script.md` | Every voice line, recorded and unrecorded |

The original design doc referenced by earlier notes
(`2026-08-13-digital-moca-design.md`) **does not exist in this repo** — it was never committed.
The Thai form details it held (remaining subtests' content, the timing table) have to come from
the user.

## How to run

```bash
npm install          # if node_modules is missing
npm run setup:asr    # ONE TIME: builds sidecar/.venv and downloads the 1.6 GB model
npm run dev          # launch the app
npm test             # 192 Vitest tests
npm run test:asr     # 10 pytest tests (the Python sidecar)
npm run test:all     # both
npm run build        # verify main/preload/renderer compile
```

The model lives in `~/.cache/huggingface/hub/`, **not** in the repo. It is downloaded once per
user profile. No network call happens at transcription time.

## Known gotchas — do not re-debug these

1. **`SSL_CERT_FILE` was broken and is now patched.** Conda's `openssl_activate.sh` set it to
   `$CONDA_PREFIX/ssl/cacert.pem`, missing the `Library/` segment Windows needs, so activating a
   conda env in bash pointed it at a nonexistent file and broke all Python HTTPS. Patched in
   `~/AppData/Local/miniconda3/etc/conda/activate.d/openssl_activate.sh` (original saved as
   `.bak-claude`). **A conda package update may overwrite it.** Symptom: the sidecar reports
   `/health: error` with a `FileNotFoundError`, and the app shows `ASR: unavailable`. The sidecar
   now names this cause explicitly in its error detail.

2. **Python probes against the sidecar need `httpx.Client(trust_env=False)`.** With `trust_env`
   on, httpx picks up a Windows registry proxy that has no localhost bypass and cannot reach
   `127.0.0.1` — producing a convincing but false "the sidecar is hung". Node's undici `fetch`
   does not read system proxy settings, so the app itself is unaffected.

3. **Audio paths must stay relative** (`moca/audio/x.mp3`, no leading slash). Production loads
   via `file://`, where a root-absolute path resolves against the drive root instead of the app
   bundle. Files live in `src/renderer/public/moca/audio/` and are referenced by URL, never
   `import` — an import of a missing file fails the build, while a missing file here is a runtime
   error the app reports with Retry and Skip.

4. **Thai has no spaces between words.** Anything matching Thai text must use substring matching
   or character scanning, never `split(' ')`. This bit `extractDigitSequence` once: Whisper
   returns `สองสี่เจ็ด` or `สอง สี่ เจ็ด` for the same utterance arbitrarily, and the
   whitespace version silently scored the run-on form as zero.

5. **`npm test` can exit 1 while every assertion passes** — an unhandled rejection leaking from a
   test produces `Errors 1 error` and a non-zero exit. Always check the exit code, not the pass
   count.

6. **Vigilance owns its own timing.** The app schedules ten per-digit files at exact one-second
   onsets rather than playing one long take, because the score depends entirely on which
   one-second window a tap landed in. Do not "simplify" this into a single recording — the
   onsets would become hand-measured estimates that need re-measuring on every re-record.

## What is verified, and what is not

**Verified end to end with real speech:** Digit Span backward transcribed `สองสี่เจ็ด` and scored
1/1 on the local engine. The sidecar loads the model in ~7.6s and `/health` stays responsive
during inference.

**All 21 audio files for the built subtests now exist**, so Serial 7s and Vigilance both run for
real. Vigilance has been through a live run: the space bar registered, the taps scored, and the
result reported 1/1 with its hit/miss counts. **Abstraction is the one now waiting on audio** —
`instr-abstraction-1.mp3` and `instr-abstraction-2.mp3` are unrecorded, so both items reach the
error screen and can be skipped.

**Not verified:** a full eleven-screen run; delayed recall accuracy on real speech (the `หน้า`
accepted-variant list includes tonal homophones `น่า`/`นา` as a deliberate gamble, unvalidated);
real-speech latency per subtest. My only latency measurement used a synthetic tone, which pushes
Whisper into worst-case decoding — treat ~3-4× realtime as pessimistic and unproven.

## Next steps, in order

1. **Record `instr-abstraction-1.mp3` and `instr-abstraction-2.mp3`** — the only unrecorded files
   left. Abstraction is built and tested but unreachable until they exist. Part 4 of
   `docs/moca-audio-recording-script.md` has the exact lines; the banana-and-orange example must
   stay in the first one.
2. **Verbal fluency (1 pt)** — cheapest remaining, and the only subtest in the app with a real
   normed deadline: exactly 60 seconds, against the "≥11 words" cutoff. Needs the timer work no
   other subtest has required.
3. **Sentence repetition (2 pts)** — needs new stimulus recordings. The
   sentences must come from the user's Thai form; they are not in this repo.
   `docs/moca-audio-recording-script.md` explains the recording conventions.
4. **A settings screen** for `place`/`province`, currently hardcoded in `SessionRunner.jsx` as
   `SESSION_CONTEXT`.
5. **Biomarker layer** — genuinely blocked until pilot sessions produce data. `responseMs` and
   `timeLimitSec` are already captured on every result as its first raw material, though see the
   caveat below.

## Important constraints — do not violate

- **Verbal fluency's time limit must be 60 seconds.** It is normed against the official MoCA's
  "≥11 words" cutoff. No other subtest has a normed response deadline, which is why the app
  deliberately enforces **no** time limits and shows **no** clock — cutting off a slow but
  correct patient would manufacture a wrong score.
- **Orientation year is Buddhist Era** (Gregorian + 543).
- **Scoring stays rule-based.** The Clock Drawing model is the only ML component in the whole
  project and is out of scope here.
- **A skipped subtest is not a zero.** Zero asserts the patient failed; skipped asserts it was
  never administered. Skipped results carry `maxScore: 0` and are excluded from both sides of the
  total, and delayed recall is marked unscorable if registration never ran.
- **The mic must never open before stimulus playback finishes.** Otherwise the ASR transcribes
  the app's own prompt and the subtest appears to pass while measuring nothing. Guarded by a
  test asserting literal call order, plus a generation counter that retires abandoned attempts.
- **Do not claim the biomarker layer is a validated diagnostic signal** for MCI/Alzheimer's in
  the demo — no clinical-outcome labels exist to validate against. Frame it as process-data
  infrastructure toward future validated screening, citing DCTclock and the ADReSS speech
  challenges as evidence the feature classes are sound.
- **`responseMs` measures mic-open duration**, which includes operator reaction time on the Stop
  button. Fine for debugging; not clean enough to treat as a biomarker without auto-stop on
  silence or speech-end detection.

## Outstanding

- **The push to `https://github.com/Pancreasz/AIAD.git` never happened.** The remote is
  configured as `origin`, but the GitHub token is expired and this session's permission
  classifier blocks `git push`. Run `gh auth login -h github.com` then `git push -u origin main`
  manually, or grant the permission.
- **Note the repo contains MoCA-derived material** — the Thai word list, digit sequences,
  instruction text, animal drawings, and audio recordings. The MoCA is copyrighted by MoCA Test
  Inc. The user was informed and chose to proceed; flagged here only so it is not a surprise.
