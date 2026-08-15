# Memory Registration, Delayed Recall, and Stimulus Audio — Design

**Status:** Approved. Not yet planned or implemented.

**Goal:** Add the MoCA Memory subtest (two registration trials plus delayed recall, 5 points) and give Digit Span the audio it has always needed, by introducing stimulus playback to the session pipeline.

**Context:** The app currently administers 3 of MoCA's 13 subtests — Naming, Digit Span, Orientation — worth 11 of 30 points. Two of those 11 are unreachable in practice: Digit Span instructs the patient to "listen to the numbers" but nothing plays any, so the patient has nothing to repeat. This design fixes that and adds the largest remaining scorer.

Builds on [`2026-08-13-local-asr-faster-whisper-design.md`](2026-08-13-local-asr-faster-whisper-design.md) and Plan 1's pipeline (`2026-08-13-moca-foundation-voice-subtests.md`).

---

## Decisions and Their Reasons

**Stimulus audio is required, not optional.** MoCA memory registration is an *auditory* encoding task: the examiner speaks five words, the patient repeats them, twice. Displaying the words on screen would change the modality being measured and invalidate the norms. The same applies to Digit Span.

**Registration scores zero.** MoCA awards no points for either registration trial; only the delayed recall at the end is worth points (5). The app records how many words came back on each trial as process data — that separates "never encoded" from "encoded but lost", a distinction a paper form discards and one this project exists to capture — but it contributes nothing to the total.

**The recall interval is measured, not enforced.** MoCA expects roughly five minutes between registration and recall. The current subtest set produces 2–3 minutes. Enforcing a wait would mean a multi-minute blank screen in front of judges, which reads as a hung app. Instead the app measures the real interval and displays it, flagging when it falls short, so the score can be weighted honestly rather than quietly over-reported.

**Playback lives in `useSubtestSession`, not `SessionRunner` or `AudioRecorder`.** See "The ordering guarantee" below — this is the only placement where the property that matters is unit-testable.

**No cued recall.** Standard MoCA offers category and multiple-choice cues after failed free recall. They are recorded but never scored. Out of scope (YAGNI).

---

## The Five Words

From the Thai MoCA-Basic form, in reading order:

| # | Thai | English equivalent |
|---|---|---|
| 1 | หน้า | face |
| 2 | ผ้าไหม | silk / velvet |
| 3 | วัด | temple / church |
| 4 | มะลิ | jasmine / daisy |
| 5 | สีแดง | red |

---

## The Ordering Guarantee

**The microphone must not open until the stimulus has finished playing.**

If recording overlaps playback, the ASR transcribes the prompt itself. Digit Span would then "pass" by hearing the app read its own numbers back — a subtest that appears to work while measuring nothing. This is the single most important property in this design, and it is why playback belongs in the hook:

- In `SessionRunner`: that file has no test coverage, so the guarantee would live in the least-verified code in the project.
- In `AudioRecorder.start()`: conflates capture with stimulus presentation, and forces the recorder to know about subtest metadata.
- In `useSubtestSession`: the hook already owns phase sequencing, and a fake player can assert call ordering in a unit test.

The dedicated test uses a fake player that records call order and asserts `play` resolved before `recorder.start` was called.

---

## Architecture

### New: `src/renderer/src/moca/AudioPlayer.js`

```js
createAudioPlayer({ audioClass = Audio }) → { play(src): Promise<void> }
```

Resolves on the audio element's `ended` event; rejects on `error`. `audioClass` is injected so tests never touch real audio — the same pattern `AudioRecorder.js` uses for `MediaRecorder`.

### Changed: the phase machine

`instruction | stimulus | recording | scoring | done | error`

`beginRecording()` becomes:

```
if (currentSubtest.audio):
    phase ← 'stimulus'
    await play(currentSubtest.audio)      # mic cannot open before this resolves
create recorder → recorder.start() → phase ← 'recording'
```

Subtests without an `audio` field skip straight to recording, unchanged.

### Playback failure routes to the existing error path

A missing or undecodable audio file means the patient cannot answer. It sets `phase: 'error'` with the message and the Retry button already built for transcription failures — never a silent skip, which would score 0 for a subtest that was never administered.

### Autoplay

Chromium blocks autoplay outside a user gesture. Playback here is triggered by the Start click, so it is inside a gesture. This becomes relevant if subtests ever auto-advance — the countdown/timer work will need to account for it.

---

## Scoring

### `src/main/scoring/memoryWords.js`

Both trials and the recall check identical content but score differently, so one file exports two scorers over a shared private matcher:

| Export | Returns |
|---|---|
| `scoreMemoryRegistration(transcript)` | `{ score: 0, maxScore: 0, recalledCount, results }` |
| `scoreDelayedRecall(transcript)` | `{ score: recalledCount, maxScore: 5, recalledCount, results }` |

Accepted-term arrays follow the shape `naming.js` already establishes:

```js
face:    ['หน้า', 'น่า', 'นา']
silk:    ['ผ้าไหม', 'ไหม']
temple:  ['วัด']
jasmine: ['มะลิ']
red:     ['สีแดง', 'แดง']
```

### The `หน้า` trade-off — deliberate, and worth revisiting

`หน้า` is a single syllable whose tonal neighbours (`นา` field, `น่า` should) are common words. Whisper's Thai is the weakest component in this stack, and delayed recall gives it the worst possible input: isolated, hesitant words with no surrounding context to disambiguate.

Accepting the homophones guards against a tone error costing a point the patient earned. The cost is the inverse error — a patient saying `นา` scores a point they did not earn, on the highest-value subtest. Accepted on the judgment that an ASR tone error is substantially more likely than someone spontaneously producing that exact word while recalling five specific items. **Revisit once real recordings exist.**

`สีแดง → แดง` and `ผ้าไหม → ไหม` are shortenings patients genuinely produce and carry no such ambiguity.

### Thai has no inter-word spaces

A transcript may arrive as one unbroken string: `หน้าผ้าไหมวัดมะลิสีแดง`. The existing `keywordMatch` uses substring matching, which handles this correctly where token-splitting would fail. A dedicated test locks the behaviour in.

---

## Session Order

```
naming → registration 1 → registration 2 → digit fwd → digit bwd
       → delayed recall → orientation
```

Recall sits before orientation, matching the real instrument, and as far from registration as the current subtest set allows.

### Identifiers

| `id` | `section` | `scorerId` | `audio` |
|---|---|---|---|
| `memory-registration-1` | `Memory (trial 1)` | `memory-registration` | `memory-words.mp3` |
| `memory-registration-2` | `Memory (trial 2)` | `memory-registration` | `memory-words.mp3` |
| `delayed-recall` | `Delayed Recall` | `delayed-recall` | *(none)* |

Both registration trials share one audio file and one scorer, differing only in `id` and `section`. The distinct `section` values matter: `SessionResults` labels rows by `section`, so two rows both reading "Memory" would be indistinguishable to anyone reading the output.

Delayed recall has no audio — the patient recalls unprompted; playing the words would defeat the subtest.

Digit Span's existing entries gain `audio: digits-forward.mp3` and `audio: digits-backward.mp3`. Their `id`, `scorerId`, and `expectedSequence` are unchanged.

---

## The Recall Interval

Each entry in `results` gains a `completedAt` timestamp (epoch milliseconds), set by the hook when it pushes the result. No scorer knows about time.

`SessionResults` computes the interval as the gap between the `completedAt` of the result whose `subtestId` is `memory-registration-2` and the one whose `subtestId` is `delayed-recall`. If either is absent — a partial session, or a run that skipped Memory — no interval is rendered at all rather than a misleading zero.

Rendered as `Delayed recall after 2m 40s`, with an explicit warning below five minutes.

---

## Results Display

A row renders `3 of 5 recalled` in place of a score when `maxScore === 0` and `recalledCount` is present; otherwise it renders `score / maxScore` as today. `maxScore: 0` rows contribute nothing to either side of the total, keeping the 30-point denominator honest.

The existing `engine` column is unchanged and applies to the new rows too.

---

## Assets Required From the User

Recorded by the user; the app cannot proceed to a real run without them.

| File | Content |
|---|---|
| `memory-words.mp3` | หน้า ผ้าไหม วัด มะลิ สีแดง — one word per second, flat tone |
| `digits-forward.mp3` | 2 – 1 – 8 – 5 – 4 (สอง หนึ่ง แปด ห้า สี่) |
| `digits-backward.mp3` | 7 – 4 – 2 (เจ็ด สี่ สอง) — the patient answers `247`; record the prompt, not the answer |

All in `src/renderer/src/assets/moca/audio/`. Digit Span requires one digit per second with no grouping or rhythm; chunking makes the span easier and breaks the norm.

**Implementation does not block on these.** Every unit test injects a fake player. The files are needed only for a real end-to-end run.

---

## Testing

| Test | Covers |
|---|---|
| `useSubtestSession.test.js` | **play resolves before `recorder.start` is called** (the ordering guarantee); no-audio subtests skip playback; playback failure → `error` phase; results carry `completedAt` |
| `memoryWords.test.js` | all five, partial, none; each accepted variant; the unbroken-string case; registration returns `0/0` with a count; recall returns `N/5` |
| `AudioPlayer.test.js` | resolves on `ended`; rejects on `error` |
| `scoring/index.test.js` | dispatch for `memory-registration` and `delayed-recall` |
| `SessionResults.test.jsx` | informational rows render the count and add nothing to the total; interval renders; under-five-minutes warning appears |

---

## Out of Scope

- Cued recall (category and multiple-choice prompts). Recorded but unscored in MoCA.
- Countdown and time-limit enforcement. Separate work; `countdownSec`/`timeLimitSec` remain unread.
- The remaining seven subtests.
- Recording the audio files themselves.

---

## Known Risks

**Whisper's Thai on isolated words is unproven here.** Every measurement so far used synthetic tones, not speech. Delayed recall is the hardest case in the app — five isolated words, no sentence context. If accuracy disappoints, the accepted-variant lists are the tuning point, and the fallback is scoring from a human transcript review rather than live.

**Registration and recall share a word list by construction.** They must never drift. Housing both scorers in one file with one shared constant makes divergence impossible by design rather than by discipline.

**A short interval inflates recall.** Mitigated by measuring and displaying it, not by enforcement. If the session grows to the full 13 subtests the interval will naturally exceed five minutes and the warning will stop appearing.
