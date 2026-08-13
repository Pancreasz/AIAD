# Digital MoCA — Handout

Continuing this project in a different Claude Code session (e.g. VS Code)? Start here.

## What this project is

Digitizing the Thai MoCA-Basic (Montreal Cognitive Assessment) so it can be self-administered without a clinician present: a patient writes with a real pen on real paper clipped to a smart pad, and speaks answers into a mic, while the app scores everything automatically and captures process data (handwriting kinematics, speech timing) that a paper test can't. Built for an innovation competition, <1 month timeline.

**Read these two documents first, in order:**

1. [`docs/superpowers/specs/2026-08-13-digital-moca-design.md`](docs/superpowers/specs/2026-08-13-digital-moca-design.md) — the full design: hardware choice (Wacom Bamboo Slate/Folio), why Electron over a pure web app, the scoring method + timing for all 13 MoCA subtests, and the research/innovation layer (multimodal biomarker deviation scoring vs. a healthy baseline).
2. [`docs/superpowers/plans/2026-08-13-moca-foundation-voice-subtests.md`](docs/superpowers/plans/2026-08-13-moca-foundation-voice-subtests.md) — the first implementation plan: 12 TDD tasks building the test-administration pipeline (instruction → record → transcribe → score → advance) and wiring it end-to-end for 4 voice-only subtests (Naming, Digit Span forward/backward, Orientation).

## Current state

- Electron + React project scaffolded at the repo root (`electron-vite`, JS not TypeScript).
- `npm install` and `npm run build` both verified working.
- **No plan tasks have been executed yet** — the plan is written and self-reviewed but Task 1 (test tooling setup) hasn't started. Pick up execution from Task 1.

## Known gotchas already hit once (don't re-debug these)

1. **`npm create @quick-start/electron` scaffolding corrupted `package.json`'s `name` field and parts of `electron-builder.yml`** when its interactive project-name prompt got piped bad input during setup. Already fixed manually — not an issue going forward unless you re-run the scaffolder.
2. **Scoped npm package names came out with backslashes instead of forward slashes** (`@electron-toolkit\preload` instead of `@electron-toolkit/preload`) — a Windows-specific bug in that same scaffolding tool. Already fixed in `package.json`.
3. **`npm run dev` threw `Error: Electron uninstall`** — the `electron` npm package downloaded its binary zip successfully (checksum verified) but never extracted it into `node_modules/electron/dist`, likely Windows Defender interfering. Fix if it recurs: check `node_modules/electron/dist` for `electron.exe`; if missing but `%LOCALAPPDATA%\electron\Cache\<hash>\electron-v*.zip` exists, extract that zip into `node_modules/electron/dist` manually and write the relative exe name (`electron.exe`) into `node_modules/electron/path.txt`.

## Before you can run the app for real

Task 7 of the plan requires an OpenAI API key for Whisper (speech-to-text). Create a `.env` file at the repo root (already gitignored):

```
OPENAI_API_KEY=sk-your-real-key-here
```

## How to run things

```bash
npm install       # if node_modules isn't already present
npm run dev       # launch the Electron app with hot reload
npm test          # run the Vitest suite (once Task 1 of the plan adds it)
npm run build     # verify main/preload/renderer all compile
```

## Next steps, in order

1. Execute the plan (`docs/superpowers/plans/2026-08-13-moca-foundation-voice-subtests.md`) task-by-task, TDD style — either via the `superpowers:subagent-driven-development` skill (fresh subagent per task, reviewed between tasks) or `superpowers:executing-plans` (inline, batch execution with checkpoints).
2. Once that plan is done and demoed, the design doc's remaining subsystems each need their own plan (write these via `superpowers:brainstorming` → `superpowers:writing-plans` if they need more design discussion first, or straight to `superpowers:writing-plans` if the design doc already covers them fully):
   - Remaining voice subtests (vigilance tap, serial-7, sentence repetition, fluency, abstraction, delayed recall, memory registration) — same pattern as the scorer tasks already in Plan 1, just extended to more subtests.
   - Pen/hardware capture (Trail Making, Cube copy, Clock Drawing Test) — needs the Wacom SDK integration; the Cube scorer needs the corner/curvature-based stroke segmentation approach described in the design doc (don't segment by pen-lift/stroke-count).
   - Biomarker/innovation layer (graphomotor + acoustic/linguistic deviation-from-healthy-baseline scoring) — needs pilot session data collected from several completed runs of the pipeline first.
   - A settings screen for session context (`place`/`province`, currently hardcoded in `SessionRunner.jsx`).
   - Automatic countdown/time-limit enforcement per subtest — `SUBTESTS` metadata already carries `countdownSec`/`timeLimitSec` (design doc's timing table), but nothing reads them yet; Plan 1's `SessionRunner` uses manual Start/Stop buttons instead.

## Important constraints to not accidentally violate

- Verbal fluency time limit must stay **60 seconds** — it's normed against the official MoCA's "≥11 words" cutoff; shortening it (as the original ask-and-answer for this project briefly considered) invalidates the score.
- Orientation year must be reported in **Buddhist Era (Gregorian year + 543)** — matches the Thai MoCA form.
- Scoring for all subtests except the Clock Drawing Test is **rule-based/deterministic** — no trained ML model. The Clock Drawing Test model already exists (built by the team) and just needs to be plugged into the pipeline when that subsystem's plan is written.
- Don't claim the biomarker/deviation-scoring layer is a validated diagnostic signal for MCI/Alzheimer's in the demo — no clinical-outcome labels exist to validate against. Frame it as process-data infrastructure toward future validated screening, citing DCTclock and the ADReSS speech-biomarker challenges as evidence the underlying feature classes are sound.
