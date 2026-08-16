# Vigilance / Digit Tap — Design

**Status:** Approved. Not yet planned or implemented.

**Goal:** Add the MoCA vigilance subtest (1 point), the last unbuilt item in the Attention
section, by introducing a second response modality — a tap timed against scheduled audio — to a
session pipeline that until now has assumed every answer arrives as speech.

**Context:** Attention is worth 6 points across three items. Digit Span (2) and Serial 7s (3) are
built and scored. Vigilance is the remaining 1 point, and the only subtest in the instrument
where the patient's answer is not something they say. Completing it closes the Attention section
at 6 of 6.

Builds on the session pipeline in
[`2026-08-15-memory-delayed-recall-design.md`](2026-08-15-memory-delayed-recall-design.md),
particularly its ordering guarantee and the generation-counter abandonment mechanism.

---

## Decisions and Their Reasons

**The app owns the timing, not the recording.** Ten one-syllable digit files played at scheduled
onsets, rather than one long take of all 29 digits with a hand-measured onset table. Vigilance is
scored by *when* a tap arrives relative to *which* digit, so onset accuracy is not a detail — it
is the measurement. A recorded take makes the app's model of the timing an estimate of a human's
approximate pacing, re-measured by hand every time the audio is re-recorded, with a mis-measured
onset invisible until scores look subtly wrong. Scheduling per-digit playback makes the onsets
exact by construction and testable under a fake clock. It is also *closer* to the instrument,
which specifies one digit per second — a metronome is more faithful here than a human voice.

**Taps ride in `context`; the scorer signature does not change.** `scoreItem(subtestId,
transcript, context)` stays as it is, with vigilance passing `transcript: ''` and its taps in
`context`. Widening the second parameter into a `string | object` union would force every
existing scorer and the IPC boundary to discriminate on shape for the sake of one subtest. There
is precedent for subtest data travelling in `context`: `expectedSequence` already does.

**Strict one-second windows, with the trade-off recorded rather than engineered around.** See
"Attributing a Tap to a Digit" below.

**No Stop button.** Every other subtest ends when the patient stops speaking and an operator
presses Stop. Vigilance ends when the sequence ends — a patient cannot be asked to declare a
listening task over, and asking would make the task about button-pressing.

**No cued repetition, no practice trial.** The instrument has neither. YAGNI.

---

## The Sequence

From the user's Thai MoCA-Basic form. The patient taps on every **1**.

```
5 2 1 3 9 4 1 1 8 0 6 2 1 5 1 9 4 5 1 1 1 4 1 9 0 5 1 1 2
```

29 digits, **11 targets**, 18 non-targets. Target positions (0-based): 2, 6, 7, 12, 14, 18, 19,
20, 22, 26, 27.

The run of three consecutive `1`s at positions 18–20 is the structurally important part: it is
where a patient who has lapsed into perseverative tapping and one who is genuinely tracking
produce identical output for three seconds, and where the following non-target `4` separates
them. Any transcription error in this sequence silently changes every score it produces, so the
constant carries a comment saying so.

Stored in `subtests.js` as a string, alongside the target digit and the interval. The scorer
derives target positions rather than storing them, so the two can never drift.

```js
const VIGILANCE_SEQUENCE = '52139411806215194511141905112'
const VIGILANCE_TARGET = '1'
const VIGILANCE_INTERVAL_MS = 1000
const VIGILANCE_LEAD_IN_MS = 1000   // silence after the instruction, before digit 1
```

The lead-in exists so the first digit does not arrive on the heels of the instruction's last
syllable. It is silence, not a countdown recording: a countdown would give the patient a rhythm
to lock onto before the task starts.

The sequence uses **nine of the ten digits — `7` never appears.** `preload()` derives the
distinct digits it needs from the sequence rather than assuming all ten, so a missing
`digit-7.mp3` breaks nothing.

---

## Attributing a Tap to a Digit

Digit *i* owns the window `[i × 1000, (i + 1) × 1000)` milliseconds from the first digit's onset.
Each tap falls in exactly one window.

- **Hit** — a target window containing at least one tap.
- **Miss** — a target window containing none.
- **False tap** — a non-target window containing at least one tap.

**Errors = misses + false taps. Score is 1 if errors ≤ 1, else 0** — the official rule.

Two taps inside one window count as one error, not two. The instrument counts errors per
letter/digit, not per hand movement, and a patient who double-taps a single target has made one
mistake about one digit.

### The late-tap trade-off

A patient whose reaction time exceeds one second is scored twice for one lapse: a miss on the
target, and a false tap on the digit after it. This is a real cost and it is accepted
deliberately.

The alternative — attributing an orphan tap in an empty non-target window back to an unhit target
immediately before it — invents a scoring rule the instrument does not have and the norms were
not built on. A ≥1000 ms simple auditory reaction time is itself the abnormality vigilance is
looking for; typical values are 300–600 ms. Engineering around it would suppress signal, not
noise.

What the design does instead is **make the trade-off visible**: the result carries
`tapLatencies`, the millisecond gap from each hit target's onset to its tap. If misses cluster at
the top of the window while latencies run long, the data says so plainly and the rule can be
revisited against evidence rather than intuition.

### Taps outside the sequence

The tap control is inert until the first digit's onset and after the last window closes at
29 000 ms. Taps during the lead-in silence are not captured at all, rather than counted as false
taps — before any digit has played there is nothing for a tap to be an error *about*, and a
nervous test-press would otherwise cost a point.

---

## Architecture

### New: `src/renderer/src/moca/DigitSequencePlayer.js`

```js
createDigitSequencePlayer({ audioClass = Audio, now, setTimer, clearTimer }) → {
  preload(digits: string[]): Promise<void>,
  play(sequence: string, { intervalMs, leadInMs, onStart }): Promise<void>,
  stop(): void
}
```

Separate from `AudioPlayer.js` because the semantics are different in kind: `AudioPlayer.play()`
resolves on the `ended` event of one file, while this schedules 29 fire-and-forget playbacks and
resolves when the last *window* closes — not when the last sound stops.

**Drift correction.** Digit *i* is scheduled against a single start reference (`start + leadInMs
+ i × intervalMs`), with the delay recomputed from `now()` before each timer. Chained
`setTimeout(…, 1000)` calls accumulate several milliseconds of error each, which over 29 digits
drifts far enough to matter against a 1000 ms window.

**Preloading is mandatory, not an optimisation.** All ten digit files are loaded to
`canplaythrough` before the sequence starts. Calling `play()` on a cold element adds a decode
delay of tens of milliseconds — variable per file, and therefore indistinguishable from patient
reaction time in the scoring. A preload failure routes to the `error` phase with Retry and Skip,
exactly as a missing stimulus file does today.

**Replay of the same element.** The digit `1` plays eleven times, three of them consecutively.
Each playback resets `currentTime = 0` before `play()`. This requires digit recordings to stay
comfortably under the interval; the recording script specifies **under 800 ms**.

`now`, `setTimer`, and `clearTimer` are injected so tests drive the whole sequence under fake
timers with no real audio and no real waiting — the same injection pattern `AudioRecorder.js` and
`AudioPlayer.js` already use.

### Changed: `useSubtestSession`

A new subtest field, `responseMode: 'tap'`. Its absence means voice, so all eight existing
subtests are untouched by construction.

`beginRecording()` is renamed **`beginSubtest()`**. It has covered "play the stimulus, then open
the mic" since stimulus audio landed; with a modality that never opens a mic, the old name
describes one branch of what it does. The rename is mechanical and touches only `SessionRunner`
and the hook's tests. `finishRecording()` keeps its name — it stays voice-only, bound to the Stop
button.

The phase machine gains one state:

```
instruction | stimulus | recording | tapping | scoring | done | error
```

Tap-mode flow:

```
phase ← 'stimulus'
await playAudio(instructionAudio)        # existing ordering guarantee, unchanged
await sequencePlayer.preload(digits)
await sequencePlayer.play(sequence, { onStart: () => {
    tapsRef ← []
    sequenceStartedAt ← now()
    phase ← 'tapping'
}})
phase ← 'scoring' → scoreItem('vigilance', '', { taps, sequence, target, intervalMs })
```

The hook exposes `recordTap()`, which pushes `now() - sequenceStartedAt` and is a no-op in any
phase but `tapping`. Completion is internal: the player's promise resolving *is* the end of the
subtest, so nothing in the UI can end it early or late.

**Abandonment.** Skip during a sequence bumps the same generation counter the voice path uses,
and additionally calls `sequencePlayer.stop()` to cancel pending timers. Without the cancel, a
skipped vigilance run keeps speaking digits over the next subtest — the identical bug class that
`stopAudio()` was added to fix, in a component that schedules 29 of them.

**The mic must never open in tap mode.** The existing ordering guarantee protects against
recording over playback; this is its sibling. A dedicated test asserts `createRecorder` is never
called for a tap-mode subtest, because a recorder left open through 29 seconds of app-generated
speech would be a live mic nobody closes.

### Changed: `SessionRunner`

A `tapping` phase renders one large tap button. Spacebar is bound as a backup — the pen is on the
Wacom pad for the drawing subtests, and a patient should not have to find a small target under
time pressure. Both paths call `recordTap()`.

Progress is deliberately **not** shown: no digit counter, no elapsed clock, no per-tap
acknowledgement. Feedback would turn a sustained-attention task into a tracking task, and a
visible count of remaining digits gives away how many targets are left.

Skip stays available throughout, as in every other phase that could otherwise strand the session.

### Unchanged: `SessionResults`

Vigilance scores `1 / 1` or `0 / 1` and renders through the existing path. `engine` is `null`
because no ASR ran; the table already renders `r.engine ?? '—'`.

---

## Scoring

### `src/main/scoring/vigilance.js`

```js
scoreVigilance(taps, { sequence, target, intervalMs }) → {
  score, maxScore: 1, errors, hits, misses, falseTaps, tapLatencies
}
```

`hits`, `misses`, and `falseTaps` are counts. `tapLatencies` is an array with one entry per hit
target, in sequence order, each the millisecond gap from that target's onset to its tap.

A pure function over numbers — no audio, no timers, no clock. It derives target positions from
`sequence` and `target` rather than accepting a position list, so the sequence constant is the
single source of truth for both what is played and what is scored.

Dispatched from `scoring/index.js` as `case 'vigilance'`, reading its arguments from `context`.

### Process data

`hits`, `misses`, `falseTaps`, and `tapLatencies` are returned and stored on the result. Latency
per target is the cleanest process signal the app has produced so far: it is a genuine
reaction-time distribution, unlike `responseMs`, which measures how long the mic was open and so
includes an operator's hand on the Stop button. This is the raw material the biomarker layer will
want, and it costs nothing to capture now.

Consistent with the project constraint: **this is process-data infrastructure, not a validated
diagnostic signal.** Nothing in the app or the demo may present it as one.

---

## Session Order

```
naming → registration 1 → registration 2 → digit fwd → digit bwd
       → vigilance → serial 7s → delayed recall → orientation
```

Vigilance sits between Digit Span and Serial 7s, the order the real instrument administers
Attention in. This moves Serial 7s one position later and flips the existing assertion in
`subtests.test.js` that Serial 7s follows Digit Span backward *immediately*.

### Identifier

| `id` | `section` | `scorerId` | `responseMode` | `instructionAudio` |
|---|---|---|---|---|
| `vigilance` | `Attention` | `vigilance` | `tap` | `instr-vigilance.mp3` |

No `audio` field: the stimulus is 29 scheduled files, not one, so it is described by `sequence`
rather than by a single path.

`timeLimitSec` is 30 — the sequence's own fixed duration (1 s lead-in + 29 s), recorded for the
process-data row. As everywhere else in this app it is a budget, not a deadline, and nothing
enforces it; here it is also simply a fact, since the subtest ends when the audio ends.

---

## Assets Required From the User

| File | Content |
|---|---|
| `digit-0.mp3` … `digit-9.mp3` | ศูนย์ หนึ่ง สอง สาม สี่ ห้า หก เจ็ด แปด เก้า — one file per digit. `digit-7.mp3` (เจ็ด) is **not used by this sequence**; record it anyway, so a later correction to the sequence does not send you back to the microphone for one word |
| `instr-vigilance.mp3` | The spoken vigilance instruction |

**Each digit file must be trimmed tight and stay under 800 ms.** Leading silence shifts that
digit's real onset away from its scheduled one and is scored as patient reaction time; trailing
length past the interval overlaps the next digit, which matters most at the `1 1 1` run where the
same file plays three times in a row.

One voice, one take per file, consistent level — the same conventions the existing stimulus files
follow. Unlike `digits-forward.mp3`, pacing is not the reader's job here: the app supplies the
rhythm, so each file needs only the word.

`instr-serial-sevens.mp3` remains outstanding from the previous piece of work and is unrelated to
this one.

**Implementation does not block on any of these.** Every test injects a fake player and a fake
clock. The files are needed only for a real end-to-end run; until they exist, vigilance reaches
the error screen and can be skipped like any other audio-dependent subtest.

---

## Testing

| Test | Covers |
|---|---|
| `vigilance.test.js` | perfect run (11 hits, 0 errors, 1 point); one miss (1 point); two misses (0); one false tap (1 point); miss + false tap (0); double-tap on one target counts once; tap in the window after a target counts as both miss and false tap; no taps at all (11 errors, 0); `tapLatencies` measured from target onset |
| `DigitSequencePlayer.test.js` | onsets land at `leadIn + i × interval` under fake timers with no accumulated drift across 29 digits; `preload` rejects → surfaced, not swallowed; `stop()` cancels pending digits; a repeated digit resets `currentTime` |
| `useSubtestSession.test.js` | **`createRecorder` is never called in tap mode**; `recordTap` is a no-op outside the `tapping` phase; taps are measured from the first digit's onset, not from Start; Skip mid-sequence calls `sequencePlayer.stop()` and retires the attempt; instruction audio still resolves before the sequence starts |
| `subtests.test.js` | vigilance is in Attention, between digit-span-backward and serial-sevens; sequence is 29 digits with 11 targets; `responseMode` is `tap` and no other subtest has one |
| `scoring/index.test.js` | dispatch for `vigilance`, reading taps from `context` |

The sequence-length and target-count assertions in `subtests.test.js` exist to catch a
transcription slip in the constant, which is otherwise silent and changes every score.

---

## Out of Scope

- Recording the audio files.
- Countdown and time-limit enforcement, still unread across the app.
- The remaining seven subtests.
- Any use of `tapLatencies` beyond storing it.

---

## Known Risks

**Playback jitter is unmeasured on the demo hardware.** `setTimeout` under a loaded Electron
renderer can fire late, and `HTMLAudioElement.play()` adds its own latency even preloaded. The
design assumes total jitter stays small against a 1000 ms window. If it does not, the visible
symptom is inflated `tapLatencies` across all targets, and the fix is scheduling through the Web
Audio API's sample clock rather than timers. Worth one manual run with the real files before the
demo.

**Strict windows may prove too harsh on real patients.** Mitigated by capturing latency rather
than by loosening the rule now — see "The late-tap trade-off". Revisit with pilot data, not
before.

**The sequence constant cannot be verified by the app.** It came from a form this repo does not
contain. The tests assert its shape — 29 digits, 11 targets — which catches a dropped or added
digit but not a transposed one. A second reading against the paper form is the only real check.
