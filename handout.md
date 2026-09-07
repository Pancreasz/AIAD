# Digital MoCA — Handout

Continuing this project in a new Claude Code session? Start here.

*Last updated 2026-08-27, after Sentence Repetition and Verbal Fluency landed. Neither is verified
with real audio yet — see "What is verified" below.*

## What this project is

Digitizing the Thai MoCA-Basic (Montreal Cognitive Assessment) so it can be self-administered
without a clinician present: a patient writes with a real pen on real paper clipped to a smart
pad, and speaks answers into a mic, while the app scores everything automatically and captures
process data (handwriting kinematics, speech timing) that a paper test can't. Built for an
innovation competition, <1 month timeline starting 2026-08-13.

## Current state

**11 of 13 subtests, 25 of 30 points.** 245 JS tests + 10 Python tests, all passing, build clean.
Not yet committed — see Outstanding.

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
| Sentence Repetition ×2 | 2 | exact-match, all-or-nothing per sentence; audio not yet recorded |
| Verbal Fluency | 1 | letter ก, ≥11 words; the only subtest with a real 60s auto-stop; audio not yet recorded |

**Not built (2 subtests, 5 points):** Trail Making (1), Cube copy (1), Clock Drawing (3) — **the
pen/Wacom subtests are being done by the user's teammates, not here.** That's everything left in
this repo's scope.

The session now runs **fourteen screens**: Memory registration and Digit Span contribute two each,
Abstraction two, and Sentence Repetition two, so screens outnumber MoCA subtests.

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
- **Two response modalities.** Voice is the default. Vigilance sets `responseMode: 'tap'`, which
  takes a different path through the same hook: no recorder, no transcription, a `tapping` phase,
  and taps carried to the scorer on the `context` argument with `transcript: ''`. A subtest without
  `responseMode` is untouched by any of it.
- **One subtest can enforce a real deadline: `autoStopMs`.** Set only on `verbal-fluency`
  (60,000ms). A `useEffect` in `useSubtestSession` calls `finishRecording()` automatically once it
  elapses, exactly as if Stop had been clicked. Every other subtest's `timeLimitSec` remains
  process-data only — nothing enforces it, and no clock is shown, on purpose (see constraints).
- **`SessionResults` has a Process data column** showing vigilance hits/misses/false taps + mean
  reaction time, and verbal fluency's qualifying word count. `responseMs` is deliberately excluded
  from it — see the constraints below.

### Read these if you need depth

| Doc | What it covers |
|---|---|
| `docs/superpowers/specs/2026-08-13-local-asr-faster-whisper-design.md` | Why local ASR, why a sidecar, the fallback policy |
| `docs/superpowers/specs/2026-08-15-memory-delayed-recall-design.md` | Memory subtest, stimulus audio, Skip semantics |
| `docs/superpowers/specs/2026-08-16-vigilance-tap-design.md` | The tap modality, window scoring, why strict windows were kept |
| `docs/superpowers/plans/2026-08-16-vigilance-tap.md` | How vigilance was built, task by task |
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
npm test             # 245 Vitest tests
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

7. **The audio files are QuickTime containers named `.mp3`.** Every one of them, including the
   ones recorded months apart. Chromium plays them fine because it sniffs content rather than
   extension, so this is the project's convention, not a bug — but an MP3 frame parser will
   return nonsense on them. Read duration from the `mvhd` box instead.

8. **The digit recordings overrun their slot, and the player absorbs it.** They run 1088–1344 ms
   against a 1000 ms interval. `DigitSequencePlayer` silences the sounding digit the moment the
   next one starts, so an over-long file loses its own tail rather than smearing into its
   neighbour. Do not remove that cut in the belief the files are short enough — they are not.
   Their lead-in is ~21 ms, which is the end that actually matters: leading silence would be
   scored as the patient's reaction time and nothing can detect it.

9. **Abstraction has an accept-list and no reject-list, on purpose.** `เป็นพาหนะที่มีล้อ`
   ("vehicles that have wheels") is a correct abstract answer carrying a concrete detail. A
   reject-list for "wheels" would strip a point the patient earned. The answers MoCA rejects share
   no vocabulary with the ones it accepts, so the accept-list cannot make that mistake. A test
   pins this case; do not "harden" it by adding rejections.

10. **`_transcribe_sync` in `sidecar/asr_server.py` MUST pass `vad_filter=True`.** Without it, a
    real run hit the app's 60s transcription timeout and errored with no OpenAI key to fall back
    to. Root cause, confirmed by direct reproduction: on CPU, faster-whisper can enter a
    repetition/hallucination loop on silence and decode to the maximum token length instead of
    stopping — measured at **53–63s for 10s of pure silence**, right at the timeout, while the
    same 10s clip with `vad_filter=True` returned in **0.5–0.7s**. Real speech is unaffected (a
    naming instruction clip transcribed correctly at the same ~15s either way). This means any
    subtest recording with real silence in it — a slow patient, or the seconds between answering
    and the operator clicking Stop — was at risk before this fix, not just edge cases. A pytest
    (`test_transcribe_enables_vad_filter_to_skip_silence`) pins this; do not remove the flag
    "for accuracy" without re-measuring the silence case first.
    - **If a Windows PowerShell/bash restart of the sidecar seems to not pick up a code change,
      check `netstat -ano` for the real PID actually holding the port.** `nohup ... &` under
      git-bash's `$!` can report an MSYS pid that isn't the real Windows process, so `taskkill` on
      it silently no-ops and the old process keeps serving. This cost real debugging time while
      verifying this exact fix.

## What is verified, and what is not

**Verified end to end with real speech:** Digit Span backward transcribed `สองสี่เจ็ด` and scored
1/1 on the local engine. The sidecar loads the model in ~7.6s and `/health` stays responsive
during inference.

**Vigilance is verified with real audio and a real run.** The space bar registered, the taps
scored, and the result reported 1/1 with its hit and miss counts. That was the first end-to-end
proof of the tap modality.

**All 27 referenced audio files now exist**, including the two Abstraction instructions that were
missing as of the last handout, and the four new files Sentence Repetition and Verbal Fluency
need. `sentence-1.wav`/`sentence-2.wav` are `.wav`, not `.mp3` — the only two stimulus files that
are; `subtests.js` points at them by their real extension, Chromium plays either format fine. To
check this yourself, pull every `moca/audio/...` path out of `subtests.js`, add one `digit-N.mp3`
per distinct digit in `VIGILANCE_SEQUENCE`, and test each for existence; the docs are not the
authority, the code is.

**Every subtest in this repo's scope is now built, tested, and reachable end to end** — Naming
through Verbal Fluency, all 25 points. Nothing is blocked on missing audio any more.

**Not verified:** any of the three most recently built/unblocked subtests (Abstraction, Sentence
Repetition, Verbal Fluency) with real speech — the audio exists but no real run has happened yet;
a full fourteen-screen run; delayed recall accuracy on real speech (the `หน้า` accepted-variant
list includes tonal homophones `น่า`/`นา` as a deliberate gamble, unvalidated); real-speech latency
per subtest. My only latency measurement used a synthetic tone, which pushes Whisper into
worst-case decoding — treat ~3-4× realtime as pessimistic and unproven.

**Verbal Fluency's word-count logic is an unvalidated gamble, the same class as the `หน้า` one.**
It recovers word boundaries from a spaceless Thai transcript by splitting on whitespace/punctuation
and betting that Whisper renders the patient's natural pauses between words as gaps. Untested
against real speech.

## Next steps, in order

1. **Run a real fourteen-screen session end to end** — nothing is blocked on missing audio any
   more, and this has never been done. Pay special attention to Abstraction, Sentence Repetition,
   and Verbal Fluency, none of which has been verified against real speech yet — especially the
   fluency word-splitting gamble above.
2. **A settings screen** for `place`/`province`, currently hardcoded in `SessionRunner.jsx` as
   `SESSION_CONTEXT`.
3. **Biomarker layer** — genuinely blocked until pilot sessions produce data. `responseMs` and
   `timeLimitSec` are already captured on every result as its first raw material, though see the
   caveat below.

## Important constraints — do not violate

- **Verbal fluency's time limit must be 60 seconds, and is now enforced** via `autoStopMs` in
  `useSubtestSession` (see Architecture). It is normed against the official MoCA's "≥11 words"
  cutoff. No other subtest has a normed response deadline, which is why every other subtest
  deliberately enforces **no** time limit and shows **no** clock — cutting off a slow but correct
  patient would manufacture a wrong score. Do not add `autoStopMs` to any other subtest.
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
  silence or speech-end detection. It is deliberately kept out of the results page's Process data
  column so nobody compares it against vigilance's real reaction times.
- **Vigilance's `tapLatencies` is the one clean signal so far** — measured from each target
  digit's own scheduled onset, so it is a genuine reaction time rather than an interval that
  happens to contain one.
- **Screen text and instruction audio must say the same thing.** A patient who hears one
  instruction and reads another has been set a second task nobody intended, and on these subtests
  that shows up as a cognitive deficit. Changing `instructionTextTh` means re-recording that file.

## Outstanding

- **Sentence Repetition and Verbal Fluency, plus the six audio files that unblocked them and
  Abstraction, are implemented but not yet committed or pushed** — new scorers
  (`sentenceRepetition.js`, `verbalFluency.js`), the three new `subtests.js` entries, the
  `autoStopMs` mechanism in `useSubtestSession.js`, the new audio under
  `src/renderer/public/moca/audio/`, and the doc updates above. Commit and push before starting
  anything else, so this state isn't lost.
- **The push works and the repo is up to date.** `git push` succeeds: git's own credentials live
  in Windows Credential Manager and are healthy. The **`gh` CLI token is separately expired** —
  `gh auth status` fails, so `gh` commands (PRs, issues) need `gh auth login -h github.com` first.
  Plain `git push` does not. The earlier note claiming the push had never happened was wrong.
- **Note the repo contains MoCA-derived material** — the Thai word list, digit sequences,
  instruction text, animal drawings, and audio recordings. The MoCA is copyrighted by MoCA Test
  Inc. The user was informed and chose to proceed; flagged here only so it is not a surprise.
