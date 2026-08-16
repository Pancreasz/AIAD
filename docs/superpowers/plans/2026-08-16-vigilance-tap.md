# Vigilance Digit-Tap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the MoCA vigilance subtest (1 point) — the patient taps every time they hear the digit `1` in a 29-digit sequence played at one digit per second — completing the Attention section at 6 of 6 points.

**Architecture:** A new `DigitSequencePlayer` schedules ten per-digit audio files at drift-corrected 1000 ms onsets and owns the timing, so a tap's offset from the first digit's onset determines which digit it belongs to. `useSubtestSession` gains a `tapping` phase that opens no microphone at all. A pure `scoreVigilance` maps taps to one-second windows and applies the official "1 point if errors ≤ 1" rule.

**Tech Stack:** Electron + React (JS, not TypeScript), Vitest + @testing-library/react, `HTMLAudioElement` via an injected `audioClass`.

**Spec:** [`docs/superpowers/specs/2026-08-16-vigilance-tap-design.md`](../specs/2026-08-16-vigilance-tap-design.md)

## Global Constraints

- **The sequence is `52139411806215194511141905112`** — 29 digits, target `1`, 11 targets at 0-based positions 2, 6, 7, 12, 14, 18, 19, 20, 22, 26, 27. Copy it by paste, never by retyping.
- **Interval is 1000 ms, lead-in is 1000 ms.**
- **Scoring: `errors = misses + falseTaps`; score 1 if `errors <= 1`, else 0. `maxScore` is 1.**
- **Audio paths stay relative** — `moca/audio/digit-3.mp3`, no leading slash. A root-absolute path resolves against the drive root under `file://` in the packaged app.
- **Thai has no inter-word spaces.** Irrelevant to this plan's matching (it works on numbers, not text) but the rule stands repo-wide.
- **No time limits are enforced and no clock is shown** anywhere in the app. `timeLimitSec` is a recorded budget only.
- **A skipped subtest is not a zero** — skipped results carry `maxScore: 0` and leave both sides of the total.
- **The microphone must never open during tap mode.** This is the tap-mode sibling of the existing "mic never opens before playback finishes" guarantee, and it has a dedicated test.
- **JS, not TypeScript.** Two-space indent, no semicolons, single quotes — match surrounding files.
- **`npm test` can exit 1 while every assertion passes** if a test leaks an unhandled rejection. Always check the exit code, not the pass count.

---

### Task 1: The vigilance scorer

**Files:**
- Create: `src/main/scoring/vigilance.js`
- Create: `src/main/scoring/vigilance.test.js`
- Modify: `src/main/scoring/index.js`
- Modify: `src/main/scoring/index.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `scoreVigilance(taps, { sequence, target, intervalMs })` returning `{ score, maxScore: 1, errors, hits, misses, falseTaps, tapLatencies }`, where `hits`/`misses`/`falseTaps`/`errors` are counts and `tapLatencies` is an array of milliseconds, one entry per hit target, in sequence order. Dispatched from `scoreItem` as `case 'vigilance'`, reading its arguments out of `context`.

- [ ] **Step 1: Write the failing tests**

Create `src/main/scoring/vigilance.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { scoreVigilance } from './vigilance.js'

// A short stand-in sequence keeps the arithmetic checkable by eye. The real
// 29-digit sequence is exercised through subtests.test.js instead.
//            index: 0    1    2    3    4
//                   5    1    3    1    9
const SEQUENCE = '51319'
const OPTIONS = { sequence: SEQUENCE, target: '1', intervalMs: 1000 }

// Mid-window, so a tap is unambiguous about which digit it belongs to.
const inWindow = (index) => index * 1000 + 500

describe('scoreVigilance', () => {
  it('scores 1 when every target is tapped and nothing else is', () => {
    const result = scoreVigilance([inWindow(1), inWindow(3)], OPTIONS)
    expect(result).toMatchObject({ score: 1, maxScore: 1, hits: 2, misses: 0, falseTaps: 0, errors: 0 })
  })

  it('still scores 1 with a single missed target, since the rule allows one error', () => {
    const result = scoreVigilance([inWindow(1)], OPTIONS)
    expect(result).toMatchObject({ score: 1, misses: 1, errors: 1 })
  })

  it('scores 0 once there are two errors', () => {
    const result = scoreVigilance([], OPTIONS)
    expect(result).toMatchObject({ score: 0, hits: 0, misses: 2, errors: 2 })
  })

  it('counts a tap on a non-target digit as a false tap', () => {
    const result = scoreVigilance([inWindow(1), inWindow(3), inWindow(4)], OPTIONS)
    expect(result).toMatchObject({ score: 1, hits: 2, falseTaps: 1, errors: 1 })
  })

  it('scores 0 for one miss plus one false tap', () => {
    const result = scoreVigilance([inWindow(1), inWindow(0)], OPTIONS)
    expect(result).toMatchObject({ score: 0, misses: 1, falseTaps: 1, errors: 2 })
  })

  // The instrument counts errors per digit, not per hand movement: a patient
  // who double-taps one target has made one mistake about one digit.
  it('counts two taps inside one window as a single event', () => {
    const result = scoreVigilance([inWindow(1), inWindow(1) + 100, inWindow(3)], OPTIONS)
    expect(result).toMatchObject({ score: 1, hits: 2, falseTaps: 0, errors: 0 })
  })

  // The deliberate cost of strict windows, locked in so it can never change
  // silently: a reaction slower than the interval is charged twice.
  it('charges a late tap as both a miss and a false tap', () => {
    const result = scoreVigilance([1000 + 1100], OPTIONS)
    expect(result).toMatchObject({ score: 0, hits: 0, misses: 2, falseTaps: 1, errors: 3 })
  })

  it('ignores taps that land before the first digit or after the last window', () => {
    const result = scoreVigilance([-200, inWindow(1), inWindow(3), 5 * 1000 + 10], OPTIONS)
    expect(result).toMatchObject({ score: 1, hits: 2, falseTaps: 0, errors: 0 })
  })

  it('measures each latency from its own target onset, not from the sequence start', () => {
    const result = scoreVigilance([1000 + 420, 3000 + 610], OPTIONS)
    expect(result.tapLatencies).toEqual([420, 610])
  })

  it('reports latency for the first tap in a window when there are several', () => {
    const result = scoreVigilance([1000 + 300, 1000 + 800, 3000 + 500], OPTIONS)
    expect(result.tapLatencies).toEqual([300, 500])
  })

  it('treats a missing tap list as no taps rather than throwing', () => {
    expect(scoreVigilance(undefined, OPTIONS)).toMatchObject({ hits: 0, misses: 2 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/scoring/vigilance.test.js`

Expected: FAIL — `Failed to resolve import "./vigilance.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/main/scoring/vigilance.js`:

```js
// MoCA gives the point for zero or one errors. There is no partial credit --
// the item is worth 1 and scores 1 or 0.
const MAX_ERRORS_FOR_POINT = 1

export function scoreVigilance(taps = [], { sequence, target, intervalMs }) {
  const digits = [...sequence]

  // A tap belongs to the digit whose window it lands in: digit i owns
  // [i * intervalMs, (i + 1) * intervalMs). Taps outside the sequence are
  // dropped rather than charged -- the tap control is inert then, so any that
  // arrive are an artefact, not a patient error.
  const firstTapByWindow = new Map()
  for (const tap of taps) {
    if (tap < 0) continue
    const index = Math.floor(tap / intervalMs)
    if (index >= digits.length) continue
    // First tap only. A second tap in the same window is the same mistake
    // about the same digit, and the first one is the reaction time.
    if (!firstTapByWindow.has(index)) firstTapByWindow.set(index, tap)
  }

  let hits = 0
  let misses = 0
  let falseTaps = 0
  const tapLatencies = []

  digits.forEach((digit, index) => {
    const tap = firstTapByWindow.get(index)
    if (digit === target) {
      if (tap === undefined) {
        misses += 1
      } else {
        hits += 1
        // Measured from this target's own onset, so the value is a reaction
        // time rather than a position in the sequence.
        tapLatencies.push(tap - index * intervalMs)
      }
    } else if (tap !== undefined) {
      falseTaps += 1
    }
  })

  const errors = misses + falseTaps

  return {
    score: errors <= MAX_ERRORS_FOR_POINT ? 1 : 0,
    maxScore: 1,
    errors,
    hits,
    misses,
    falseTaps,
    tapLatencies
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/scoring/vigilance.test.js`

Expected: PASS, 11 tests.

- [ ] **Step 5: Write the failing dispatch test**

Add to `src/main/scoring/index.test.js`, inside the existing top-level `describe`:

```js
  it('dispatches to the vigilance scorer, reading taps from the context', () => {
    const result = scoreItem('vigilance', '', {
      taps: [1500],
      sequence: '51',
      target: '1',
      intervalMs: 1000
    })
    expect(result).toMatchObject({ score: 1, maxScore: 1, hits: 1 })
  })
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/main/scoring/index.test.js`

Expected: FAIL — `No scorer registered for subtest "vigilance"`.

- [ ] **Step 7: Register the scorer**

In `src/main/scoring/index.js`, add the import beneath the existing ones:

```js
import { scoreVigilance } from './vigilance.js'
```

and the case above `default:`:

```js
    case 'vigilance':
      // The only scorer whose answer is not speech: `transcript` is always ''
      // and the response arrives as tap offsets on the context.
      return scoreVigilance(context.taps, context)
```

- [ ] **Step 8: Run the scoring suite to verify it passes**

Run: `npx vitest run src/main/scoring/`

Expected: PASS, all scoring tests including the new dispatch case.

- [ ] **Step 9: Commit**

```bash
git add src/main/scoring/vigilance.js src/main/scoring/vigilance.test.js src/main/scoring/index.js src/main/scoring/index.test.js
git commit -m "feat: score the vigilance tap task"
```

---

### Task 2: The digit sequence player

**Files:**
- Create: `src/renderer/src/moca/DigitSequencePlayer.js`
- Create: `src/renderer/src/moca/DigitSequencePlayer.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `createDigitSequencePlayer({ audioClass, now, setTimer, clearTimer })` returning `{ preload(digits), play(sequence, { intervalMs, leadInMs, onStart }), stop() }`. `preload` resolves once every distinct digit file reaches `canplaythrough` and rejects on a load error. `play` resolves when the final window closes at `leadInMs + sequence.length * intervalMs`, and calls `onStart` at the instant digit 0 plays — that instant is the origin all tap offsets are measured from. `stop()` cancels pending digits and leaves `play`'s promise permanently unsettled.

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/moca/DigitSequencePlayer.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDigitSequencePlayer } from './DigitSequencePlayer.js'

// A fake HTMLAudioElement: records every play() with the fake clock's time, so
// tests assert onsets rather than waiting 29 real seconds.
function makeAudioClass(log, { failSrc } = {}) {
  return class FakeAudio {
    constructor(src) {
      this.src = src
      this.currentTime = 0
      this.paused = false
      // Load outcome is delivered asynchronously, as a real element does.
      setTimeout(() => {
        if (src === failSrc) this.onerror?.()
        else this.oncanplaythrough?.()
      }, 0)
    }
    load() {}
    play() {
      log.push({ src: this.src, at: Date.now(), currentTime: this.currentTime })
      return Promise.resolve()
    }
    pause() {
      this.paused = true
    }
  }
}

function setup({ failSrc } = {}) {
  const log = []
  const player = createDigitSequencePlayer({
    audioClass: makeAudioClass(log, { failSrc }),
    now: () => Date.now(),
    setTimer: setTimeout,
    clearTimer: clearTimeout
  })
  return { player, log }
}

describe('createDigitSequencePlayer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves preload once every digit file can play through', async () => {
    const { player } = setup()
    const loaded = player.preload(['1', '5'])
    await vi.advanceTimersByTimeAsync(1)
    await expect(loaded).resolves.toBeUndefined()
  })

  it('rejects preload naming the file that failed', async () => {
    const { player } = setup({ failSrc: 'moca/audio/digit-5.mp3' })
    const loaded = player.preload(['1', '5'])
    await vi.advanceTimersByTimeAsync(1)
    await expect(loaded).rejects.toThrow('moca/audio/digit-5.mp3')
  })

  it('plays each digit at its scheduled onset with no accumulated drift', async () => {
    const { player, log } = setup()
    const loaded = player.preload(['1', '5', '9'])
    await vi.advanceTimersByTimeAsync(1)
    await loaded

    const start = Date.now()
    player.play('595191', { intervalMs: 1000, leadInMs: 1000 })
    await vi.advanceTimersByTimeAsync(1000 + 6 * 1000)

    const offsets = log.map((entry) => entry.at - start)
    // Lead-in, then one per second. The last digit is the sixth, at 6000ms.
    expect(offsets).toEqual([1000, 2000, 3000, 4000, 5000, 6000])
  })

  it('plays the file matching each digit, in sequence order', async () => {
    const { player, log } = setup()
    const loaded = player.preload(['1', '9'])
    await vi.advanceTimersByTimeAsync(1)
    await loaded

    player.play('191', { intervalMs: 1000, leadInMs: 0 })
    await vi.advanceTimersByTimeAsync(3000)

    expect(log.map((entry) => entry.src)).toEqual([
      'moca/audio/digit-1.mp3',
      'moca/audio/digit-9.mp3',
      'moca/audio/digit-1.mp3'
    ])
  })

  // The digit 1 plays eleven times in the real sequence, three of them back to
  // back. Without a rewind the element is already at its end and stays silent.
  it('rewinds a repeated digit before replaying it', async () => {
    const { player, log } = setup()
    const loaded = player.preload(['1'])
    await vi.advanceTimersByTimeAsync(1)
    await loaded

    player.play('111', { intervalMs: 1000, leadInMs: 0 })
    await vi.advanceTimersByTimeAsync(3000)

    expect(log).toHaveLength(3)
    expect(log.every((entry) => entry.currentTime === 0)).toBe(true)
  })

  it('calls onStart when the first digit plays, not when play is called', async () => {
    const { player } = setup()
    const loaded = player.preload(['1'])
    await vi.advanceTimersByTimeAsync(1)
    await loaded

    const onStart = vi.fn()
    player.play('11', { intervalMs: 1000, leadInMs: 1000, onStart })
    expect(onStart).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    expect(onStart).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('resolves only after the final window closes', async () => {
    const { player } = setup()
    const loaded = player.preload(['1'])
    await vi.advanceTimersByTimeAsync(1)
    await loaded

    const settled = vi.fn()
    player.play('11', { intervalMs: 1000, leadInMs: 1000 }).then(settled)

    // Last digit has sounded, but its window is still open.
    await vi.advanceTimersByTimeAsync(1000 + 1000)
    expect(settled).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    expect(settled).toHaveBeenCalled()
  })

  // Same bug class stopAudio() was added for: a skipped subtest that keeps
  // speaking over the next one. Here it would be 29 of them.
  it('stops playing further digits after stop()', async () => {
    const { player, log } = setup()
    const loaded = player.preload(['1'])
    await vi.advanceTimersByTimeAsync(1)
    await loaded

    player.play('1111', { intervalMs: 1000, leadInMs: 0 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(log).toHaveLength(2)

    player.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(log).toHaveLength(2)
  })

  it('leaves the play promise unsettled after stop(), so the caller is retired by the hook rather than resumed', async () => {
    const { player } = setup()
    const loaded = player.preload(['1'])
    await vi.advanceTimersByTimeAsync(1)
    await loaded

    const settled = vi.fn()
    player.play('11', { intervalMs: 1000, leadInMs: 0 }).then(settled)
    await vi.advanceTimersByTimeAsync(500)
    player.stop()
    await vi.advanceTimersByTimeAsync(10000)

    expect(settled).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/moca/DigitSequencePlayer.test.js`

Expected: FAIL — `Failed to resolve import "./DigitSequencePlayer.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/src/moca/DigitSequencePlayer.js`:

```js
// Relative, never root-absolute: production loads via file://, where a leading
// slash resolves against the drive root instead of the app bundle.
const srcFor = (digit) => `moca/audio/digit-${digit}.mp3`

// Separate from AudioPlayer.js on purpose. That one plays one file and
// resolves on `ended`; this one schedules many and resolves when the last
// WINDOW closes, which is a different moment from when the last sound stops.
export function createDigitSequencePlayer({
  audioClass = Audio,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  const elements = new Map()
  let timers = []
  let cancelled = false

  // Preloading is not an optimisation. A cold element adds tens of
  // milliseconds of decode delay before its first sound, varying per file --
  // which lands in the scoring as if it were patient reaction time.
  function preload(digits) {
    return Promise.all(
      digits.map(
        (digit) =>
          new Promise((resolve, reject) => {
            const audio = new audioClass(srcFor(digit))
            audio.preload = 'auto'
            audio.oncanplaythrough = () => resolve()
            audio.onerror = () => reject(new Error(`Failed to load digit audio: ${srcFor(digit)}`))
            elements.set(digit, audio)
            if (typeof audio.load === 'function') audio.load()
          })
      )
    ).then(() => undefined)
  }

  function play(sequence, { intervalMs, leadInMs = 0, onStart } = {}) {
    cancelled = false
    const digits = [...sequence]
    const start = now()

    return new Promise((resolve) => {
      // Every delay is recomputed against one shared start reference. Chaining
      // setTimeout(fn, interval) instead lets each timer's few milliseconds of
      // lateness carry into the next, which over 29 digits drifts far enough
      // to matter against a 1000ms window.
      const at = (offsetMs, fn) => {
        timers.push(setTimer(fn, Math.max(0, start + offsetMs - now())))
      }

      digits.forEach((digit, index) => {
        at(leadInMs + index * intervalMs, () => {
          if (cancelled) return
          // Fires at the first digit's onset, which is the origin every tap
          // offset is measured from -- not when play() was called, since the
          // lead-in sits in between.
          if (index === 0 && onStart) onStart()

          const audio = elements.get(digit)
          if (!audio) return
          // The same element plays repeatedly, and is at its end by the second
          // time round.
          audio.currentTime = 0
          const started = audio.play()
          // A digit that fails to sound is a scoring problem, not a crash: it
          // shows up as a miss in the result rather than killing the session
          // mid-sequence.
          if (started && typeof started.catch === 'function') started.catch(() => {})
        })
      })

      at(leadInMs + digits.length * intervalMs, () => {
        if (cancelled) return
        resolve()
      })
    })
  }

  // Deliberately leaves play()'s promise unsettled, exactly as
  // AudioPlayer.stop() does: a stopped sequence was abandoned, not completed,
  // and resolving would let the caller score a subtest that never finished.
  // The hook's generation guard is what retires that caller.
  function stop() {
    cancelled = true
    for (const timer of timers) clearTimer(timer)
    timers = []
    for (const audio of elements.values()) audio.pause()
  }

  return { preload, play, stop }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/moca/DigitSequencePlayer.test.js`

Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/moca/DigitSequencePlayer.js src/renderer/src/moca/DigitSequencePlayer.test.js
git commit -m "feat: schedule per-digit playback at exact onsets"
```

---

### Task 3: Tap modality in the session hook

**Files:**
- Modify: `src/renderer/src/moca/useSubtestSession.js`
- Modify: `src/renderer/src/moca/useSubtestSession.test.js`

**Interfaces:**
- Consumes: the player contract from Task 2, injected as three plain functions rather than an object, matching how `playAudio`/`stopAudio` are already injected: `preloadDigits(digits)`, `playDigitSequence(sequence, { intervalMs, leadInMs, onStart })`, `stopDigitSequence()`. All three are optional, so the eight existing voice subtests and their tests are unaffected.
- Produces: `beginSubtest()` (renamed from `beginRecording()`), `recordTap()`, and a `tapping` phase. A vigilance result carries `transcript: ''`, `engine: null`, and the scorer's `hits`/`misses`/`falseTaps`/`errors`/`tapLatencies`.

- [ ] **Step 1: Rename `beginRecording` to `beginSubtest`**

It has covered "play the stimulus, then open the mic" since stimulus audio landed; with a modality that never opens a mic, the old name describes only one branch. Mechanical rename, three files:

```bash
# The declaration and the returned key in the hook
# The call site in SessionRunner
# Every call in the hook's tests
grep -rln "beginRecording" src/
```

Replace `beginRecording` with `beginSubtest` in `src/renderer/src/moca/useSubtestSession.js`, `src/renderer/src/moca/SessionRunner.jsx`, and `src/renderer/src/moca/useSubtestSession.test.js`. Leave `finishRecording` alone — it stays voice-only, bound to the Stop button.

- [ ] **Step 2: Run the full suite to verify the rename broke nothing**

Run: `npm test`

Expected: PASS, 158 tests, exit code 0. Check the exit code, not the pass count.

- [ ] **Step 3: Commit the rename on its own**

Keeping it separate means the behavioural diff that follows is readable.

```bash
git add src/renderer/src/moca/useSubtestSession.js src/renderer/src/moca/SessionRunner.jsx src/renderer/src/moca/useSubtestSession.test.js
git commit -m "refactor: rename beginRecording to beginSubtest"
```

- [ ] **Step 4: Write the failing tests**

Add to `src/renderer/src/moca/useSubtestSession.test.js`. This needs its own setup because the tap path injects different dependencies:

```js
const tapSubtest = {
  id: 'vigilance',
  scorerId: 'vigilance',
  responseMode: 'tap',
  sequence: '51319',
  target: '1',
  intervalMs: 1000,
  leadInMs: 1000,
  instructionAudio: 'moca/audio/instr-vigilance.mp3'
}

function setupTap() {
  const base = setup()
  // The shared setup() resolves playAudio on a 5ms timer, to prove ordering in
  // the voice tests. Here that timer would race every `await act(...)`, so the
  // tap tests resolve instruction audio on a microtask instead and leave the
  // ordering guarantee to the test that exists for it.
  base.playAudio = vi.fn().mockResolvedValue(undefined)
  let releaseSequence
  let startSequence
  const preloadDigits = vi.fn().mockResolvedValue(undefined)
  const playDigitSequence = vi.fn().mockImplementation((sequence, { onStart }) => {
    // Hands the test the two moments that matter: when the first digit sounds
    // (taps start counting) and when the last window closes (scoring runs).
    startSequence = onStart
    return new Promise((resolve) => {
      releaseSequence = resolve
    })
  })
  const stopDigitSequence = vi.fn()
  return {
    ...base,
    preloadDigits,
    playDigitSequence,
    stopDigitSequence,
    startSequence: () => startSequence(),
    releaseSequence: () => releaseSequence()
  }
}

describe('useSubtestSession in tap mode', () => {
  // The tap-mode sibling of the "mic never opens before playback finishes"
  // guarantee. A recorder left open through 29 seconds of the app's own voice
  // is a live microphone nobody closes.
  it('never creates a recorder', async () => {
    const deps = setupTap()
    const { result } = renderHook(() => useSubtestSession([tapSubtest], deps))

    await act(async () => {
      result.current.beginSubtest()
    })
    await act(async () => {
      deps.startSequence()
    })
    await act(async () => {
      deps.releaseSequence()
    })

    expect(deps.createRecorder).not.toHaveBeenCalled()
    expect(deps.transcribeAudio).not.toHaveBeenCalled()
  })

  it('preloads only the distinct digits the sequence actually uses', async () => {
    const deps = setupTap()
    const { result } = renderHook(() => useSubtestSession([tapSubtest], deps))

    await act(async () => {
      result.current.beginSubtest()
    })

    expect(deps.preloadDigits).toHaveBeenCalledWith(['5', '1', '3', '9'])
  })

  it('enters the tapping phase when the first digit sounds, not when Start is pressed', async () => {
    const deps = setupTap()
    const { result } = renderHook(() => useSubtestSession([tapSubtest], deps))

    await act(async () => {
      result.current.beginSubtest()
    })
    expect(result.current.phase).toBe('stimulus')

    await act(async () => {
      deps.startSequence()
    })
    expect(result.current.phase).toBe('tapping')
  })

  it('measures taps from the first digit onset and scores them', async () => {
    const deps = setupTap()
    const { result } = renderHook(() => useSubtestSession([tapSubtest], deps))
    const nowSpy = vi.spyOn(Date, 'now')

    await act(async () => {
      result.current.beginSubtest()
    })

    nowSpy.mockReturnValue(10_000)
    await act(async () => {
      deps.startSequence()
    })

    nowSpy.mockReturnValue(11_400)
    act(() => {
      result.current.recordTap()
    })
    nowSpy.mockReturnValue(13_500)
    act(() => {
      result.current.recordTap()
    })

    nowSpy.mockRestore()
    await act(async () => {
      deps.releaseSequence()
    })

    expect(deps.scoreItem).toHaveBeenCalledWith(
      'vigilance',
      '',
      expect.objectContaining({
        taps: [1400, 3500],
        sequence: '51319',
        target: '1',
        intervalMs: 1000
      })
    )
  })

  it('ignores taps outside the tapping phase', async () => {
    const deps = setupTap()
    const { result } = renderHook(() => useSubtestSession([tapSubtest], deps))

    act(() => {
      result.current.recordTap()
    })
    await act(async () => {
      result.current.beginSubtest()
    })
    act(() => {
      result.current.recordTap()
    })
    await act(async () => {
      deps.startSequence()
    })
    await act(async () => {
      deps.releaseSequence()
    })

    expect(deps.scoreItem).toHaveBeenCalledWith('vigilance', '', expect.objectContaining({ taps: [] }))
  })

  it('records the result with no transcript and no engine', async () => {
    const deps = setupTap()
    deps.scoreItem.mockResolvedValue({ score: 1, maxScore: 1, hits: 11, misses: 0, falseTaps: 0 })
    const { result } = renderHook(() => useSubtestSession([tapSubtest], deps))

    await act(async () => {
      result.current.beginSubtest()
    })
    await act(async () => {
      deps.startSequence()
    })
    await act(async () => {
      deps.releaseSequence()
    })

    expect(result.current.phase).toBe('done')
    expect(result.current.results[0]).toMatchObject({
      subtestId: 'vigilance',
      score: 1,
      maxScore: 1,
      transcript: '',
      engine: null
    })
  })

  it('cancels the sequence when the subtest is skipped mid-run', async () => {
    const deps = setupTap()
    const { result } = renderHook(() => useSubtestSession([tapSubtest], deps))

    await act(async () => {
      result.current.beginSubtest()
    })
    await act(async () => {
      deps.startSequence()
    })
    act(() => {
      result.current.skipSubtest()
    })

    expect(deps.stopDigitSequence).toHaveBeenCalled()
    expect(result.current.results[0]).toMatchObject({ subtestId: 'vigilance', skipped: true })
  })

  it('routes a preload failure to the error phase rather than a silent skip', async () => {
    const deps = setupTap()
    deps.preloadDigits.mockRejectedValue(new Error('Failed to load digit audio: moca/audio/digit-3.mp3'))
    const { result } = renderHook(() => useSubtestSession([tapSubtest], deps))

    await act(async () => {
      result.current.beginSubtest()
    })

    expect(result.current.phase).toBe('error')
    expect(result.current.error).toContain('digit-3.mp3')
  })
})
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/moca/useSubtestSession.test.js`

Expected: FAIL — `result.current.recordTap is not a function`.

- [ ] **Step 6: Add the tap branch to the hook**

In `src/renderer/src/moca/useSubtestSession.js`, take the three new dependencies in the destructured second parameter:

```js
export function useSubtestSession(
  subtests,
  {
    transcribeAudio,
    scoreItem,
    createRecorder,
    playAudio,
    stopAudio,
    preloadDigits,
    playDigitSequence,
    stopDigitSequence
  },
  sessionContext = {}
) {
```

Add two refs next to the existing ones:

```js
  const tapsRef = useRef([])
  const sequenceStartedAtRef = useRef(null)
```

Extract the result push both finish paths share, placed above `beginSubtest`. **Then replace the
tail of `finishRecording` — everything from `setResults((prev) => [...` through its
`setPhase('done')` — with a single `completeSubtest(scoreResult, { transcript, engine, responseMs })`
call**, so there is one advance path rather than two that can drift:

```js
  // Both modalities end the same way: append a result, then advance or finish.
  // The hook's own fields are written after the scorer's spread so a scorer
  // can never overwrite subtestId, transcript, or engine.
  const completeSubtest = useCallback(
    (scoreResult, fields) => {
      setResults((prev) => [
        ...prev,
        {
          ...scoreResult,
          subtestId: currentSubtest.id,
          timeLimitSec: currentSubtest.timeLimitSec || null,
          completedAt: Date.now(),
          ...fields
        }
      ])
      if (index + 1 < subtests.length) {
        setIndex((prev) => prev + 1)
        setPhase('instruction')
      } else {
        setPhase('done')
      }
    },
    [currentSubtest, index, subtests.length]
  )
```

Add the tap runner above `beginSubtest`:

```js
  // Vigilance only. No recorder is created and no transcription happens: the
  // answer is when the patient tapped, not anything they said.
  const runTapSequence = useCallback(
    async (generation, abandoned) => {
      const distinctDigits = [...new Set(currentSubtest.sequence)]
      await preloadDigits(distinctDigits)
      if (abandoned()) return

      tapsRef.current = []

      await playDigitSequence(currentSubtest.sequence, {
        intervalMs: currentSubtest.intervalMs,
        leadInMs: currentSubtest.leadInMs,
        onStart: () => {
          if (abandoned()) return
          // The origin for every tap offset. Set here rather than at Start,
          // because the lead-in silence sits in between and a tap during it
          // is not an answer to any digit.
          sequenceStartedAtRef.current = Date.now()
          setPhase('tapping')
        }
      })
      if (abandoned()) return

      setPhase('scoring')
      const taps = tapsRef.current
      const responseMs = Date.now() - sequenceStartedAtRef.current
      const scoreResult = await scoreItem(currentSubtest.scorerId, '', {
        taps,
        sequence: currentSubtest.sequence,
        target: currentSubtest.target,
        intervalMs: currentSubtest.intervalMs,
        referenceDate: new Date(),
        ...sessionContext
      })
      if (abandoned()) return

      completeSubtest(scoreResult, {
        transcript: '',
        // No ASR ran. SessionResults already renders `engine ?? '—'`.
        engine: null,
        responseMs
      })
    },
    [currentSubtest, preloadDigits, playDigitSequence, scoreItem, sessionContext, completeSubtest]
  )
```

In `beginSubtest`, after the instruction-audio block and before `createRecorder()`, branch out of the voice path:

```js
      if (currentSubtest.responseMode === 'tap') {
        await runTapSequence(generation, abandoned)
        return
      }
```

Add `runTapSequence` to `beginSubtest`'s dependency array.

Expose the tap recorder:

```js
  // A no-op outside the tapping phase: a press during the lead-in or after
  // the last window is not an answer to any digit, so it must not become one.
  const recordTap = useCallback(() => {
    if (phase !== 'tapping') return
    tapsRef.current = [...tapsRef.current, Date.now() - sequenceStartedAtRef.current]
  }, [phase])
```

Cancel the sequence on abandonment, in `abandonAttempt`:

```js
    if (stopDigitSequence) stopDigitSequence()
```

and add `stopDigitSequence` to its dependency array.

Finally add `recordTap` to the returned object.

- [ ] **Step 7: Run the hook tests to verify they pass**

Run: `npx vitest run src/renderer/src/moca/useSubtestSession.test.js`

Expected: PASS — the existing voice tests plus the nine new tap tests.

- [ ] **Step 8: Run the full suite**

Run: `npm test`

Expected: PASS, exit code 0. The eight voice subtests must be untouched — `responseMode` is absent on all of them, so they never reach the tap branch.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/moca/useSubtestSession.js src/renderer/src/moca/useSubtestSession.test.js
git commit -m "feat: add a tap response modality to the session pipeline"
```

---

### Task 4: Register the vigilance subtest

**Files:**
- Modify: `src/renderer/src/moca/subtests.js`
- Modify: `src/renderer/src/moca/subtests.test.js`

**Interfaces:**
- Consumes: the `vigilance` scorer id from Task 1 and the `responseMode: 'tap'` contract from Task 3.
- Produces: a `SUBTESTS` entry with `id: 'vigilance'`, `section: 'Attention'`, `scorerId: 'vigilance'`, `responseMode: 'tap'`, `sequence`, `target`, `intervalMs`, `leadInMs`, `timeLimitSec: 30`, and `instructionAudio`, positioned between `digit-span-backward` and `serial-sevens`.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/moca/subtests.test.js`, replace the existing Serial 7s ordering test — vigilance now sits between it and digit span, so "after digit span backward" alone no longer pins the order:

```js
  it('administers Attention in the instrument order: digit span, vigilance, serial 7s', () => {
    const ids = SUBTESTS.map((s) => s.id)
    expect(ids.indexOf('vigilance')).toBeGreaterThan(ids.indexOf('digit-span-backward'))
    expect(ids.indexOf('serial-sevens')).toBeGreaterThan(ids.indexOf('vigilance'))
  })
```

and add:

```js
  it('includes vigilance in the Attention section as a tap subtest', () => {
    const vigilance = SUBTESTS.find((s) => s.id === 'vigilance')
    expect(vigilance).toBeDefined()
    expect(vigilance.section).toBe('Attention')
    expect(vigilance.responseMode).toBe('tap')
  })

  it('leaves every other subtest in voice mode', () => {
    const tapSubtests = SUBTESTS.filter((s) => s.responseMode === 'tap')
    expect(tapSubtests.map((s) => s.id)).toEqual(['vigilance'])
  })

  // The sequence came from a paper form this repo does not contain, and a
  // dropped or added digit changes every score it produces while looking
  // entirely normal. This catches that; only a second reading against the form
  // catches a transposition.
  it('carries the form sequence: 29 digits with 11 targets', () => {
    const vigilance = SUBTESTS.find((s) => s.id === 'vigilance')
    expect(vigilance.sequence).toHaveLength(29)
    expect([...vigilance.sequence].filter((d) => d === vigilance.target)).toHaveLength(11)
  })

  it('gives vigilance no single stimulus file, since its stimulus is 29 scheduled ones', () => {
    const vigilance = SUBTESTS.find((s) => s.id === 'vigilance')
    expect(vigilance.audio).toBeUndefined()
  })
```

The existing "registers a scorer for every subtest" test builds a context that vigilance's scorer will now read. Add the tap fields to that object so it still exercises every scorer without throwing:

```js
    const context = {
      expectedSequence: '',
      referenceDate: new Date(),
      place: 'โรงพยาบาลตัวอย่าง',
      province: 'กรุงเทพ',
      // The tap modality's half of the context shape.
      taps: [],
      sequence: '1',
      target: '1',
      intervalMs: 1000
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/moca/subtests.test.js`

Expected: FAIL — `expect(received).toBeDefined()` on the vigilance lookup.

- [ ] **Step 3: Add the config constants**

In `src/renderer/src/moca/subtests.js`, beneath the existing stimulus-audio constants:

```js
// Vigilance: the patient taps every time they hear the target digit. Straight
// from the user's Thai MoCA-Basic form -- 29 digits, 11 of them targets. A
// single wrong digit here changes every score the subtest produces and looks
// completely normal, so subtests.test.js asserts its shape.
//
// The three consecutive targets at positions 18-20 are the structurally
// important part: they are where a patient tapping perseveratively and one
// genuinely tracking produce identical output, and the non-target that follows
// separates them.
const VIGILANCE_SEQUENCE = '52139411806215194511141905112'
const VIGILANCE_TARGET = '1'
const VIGILANCE_INTERVAL_MS = 1000
// Silence between the instruction and the first digit, so the sequence does
// not start on the heels of the instruction's last syllable. Silence rather
// than a countdown: a countdown hands the patient a rhythm to lock onto
// before the task begins.
const VIGILANCE_LEAD_IN_MS = 1000
```

Add `vigilance: 'moca/audio/instr-vigilance.mp3'` to the `INSTR` map.

- [ ] **Step 4: Add the subtest entry**

Insert between the `digit-span-backward` and `serial-sevens` entries in `SUBTESTS`:

```js
  {
    id: 'vigilance',
    section: 'Attention',
    instructionTextEn:
      'You will hear a list of numbers. Tap the button every time you hear the number 1.',
    instructionTextTh: 'คุณจะได้ยินตัวเลขหลายตัว ให้เคาะปุ่มทุกครั้งที่ได้ยินเลข 1',
    countdownSec: 0,
    // The sequence's own fixed duration: 1s lead-in plus 29 digits at 1s each.
    // A recorded fact rather than a deadline -- the subtest ends when the audio
    // ends, so there is nothing here to enforce.
    timeLimitSec: 30,
    scorerId: 'vigilance',
    responseMode: 'tap',
    sequence: VIGILANCE_SEQUENCE,
    target: VIGILANCE_TARGET,
    intervalMs: VIGILANCE_INTERVAL_MS,
    leadInMs: VIGILANCE_LEAD_IN_MS,
    instructionAudio: INSTR.vigilance
    // No `audio`: the stimulus is 29 scheduled files, described by `sequence`
    // rather than by one path.
  },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/moca/subtests.test.js`

Expected: PASS.

- [ ] **Step 6: Verify the sequence survived the paste**

Run:

```bash
node -e "const s='52139411806215194511141905112';console.log(s.length,[...s].filter(d=>d==='1').length)"
```

Expected: `29 11`. If either number differs, the constant was corrupted in transit — re-paste from the spec rather than retyping.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/moca/subtests.js src/renderer/src/moca/subtests.test.js
git commit -m "feat: register vigilance between digit span and serial 7s"
```

---

### Task 5: Wire the tap UI

**Files:**
- Modify: `src/renderer/src/moca/SessionRunner.jsx`

**Interfaces:**
- Consumes: `createDigitSequencePlayer` (Task 2), `beginSubtest`/`recordTap`/the `tapping` phase (Task 3).
- Produces: no exports; this is the composition root.

This file has no test coverage, by long standing — it is the composition root and every testable property has been pushed down into the hook. Verification here is a manual run.

- [ ] **Step 1: Construct the player at module scope**

Beneath the existing `const audioPlayer = createAudioPlayer()`:

```js
// Module scope for the same reason audioPlayer is: it holds preloaded audio
// elements, and rebuilding it per render would re-download every digit.
const digitSequencePlayer = createDigitSequencePlayer()
```

with the import alongside the others:

```js
import { createDigitSequencePlayer } from './DigitSequencePlayer.js'
```

- [ ] **Step 2: Inject the three functions and take `recordTap`**

Add to the dependency object passed to `useSubtestSession`:

```js
      preloadDigits: (digits) => digitSequencePlayer.preload(digits),
      playDigitSequence: (sequence, options) => digitSequencePlayer.play(sequence, options),
      stopDigitSequence: () => digitSequencePlayer.stop()
```

and add `recordTap` to the destructured return.

- [ ] **Step 3: Render the tapping phase**

Add beside the existing phase blocks:

```jsx
      {phase === 'tapping' && (
        <>
          {/* No progress indicator, no digit counter, no per-tap
              acknowledgement: feedback would turn a sustained-attention task
              into a tracking task, and showing how many digits remain gives
              away how many targets are left. */}
          <button className="tap-target" onClick={recordTap}>
            TAP
          </button>
          <button onClick={skipSubtest}>Skip this subtest</button>
        </>
      )}
```

- [ ] **Step 4: Bind the spacebar as a backup**

The pen is on the Wacom pad for the drawing subtests, and a patient should not have to find a small on-screen target under time pressure. Add above the `phase === 'done'` early return, after the existing ASR-status effect:

```jsx
  useEffect(() => {
    if (phase !== 'tapping') return
    const onKeyDown = (event) => {
      if (event.code !== 'Space') return
      // Otherwise the browser also treats it as a click on whatever is
      // focused, double-counting a tap.
      event.preventDefault()
      recordTap()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [phase, recordTap])
```

- [ ] **Step 5: Style the tap target**

In `src/renderer/src/assets/main.css`, following whatever conventions that file already uses:

```css
.tap-target {
  display: block;
  width: 100%;
  min-height: 40vh;
  font-size: 2rem;
  margin-bottom: 1rem;
}
```

- [ ] **Step 6: Verify the build compiles**

Run: `npm run build`

Expected: main, preload, and renderer all build with no errors.

- [ ] **Step 7: Run the full suite**

Run: `npm test`

Expected: PASS, exit code 0.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/moca/SessionRunner.jsx src/renderer/src/assets/main.css
git commit -m "feat: render the vigilance tap target"
```

---

### Task 6: Document the recordings

**Files:**
- Modify: `docs/moca-audio-recording-script.md`
- Modify: `src/renderer/public/moca/audio/README.md`
- Modify: `handout.md`

**Interfaces:**
- Consumes: the filenames from Task 2 (`digit-N.mp3`) and Task 4 (`instr-vigilance.mp3`).
- Produces: nothing code depends on.

- [ ] **Step 1: Add the vigilance section to the recording script**

In `docs/moca-audio-recording-script.md`, replace the "Vigilance / letter tap" bullet under "Audio needed by subtests not yet built" — it is built now, and it is digits rather than letters — and add a full section after Part 2:

```markdown
## Part 3 — Vigilance (built, needs audio)

Eleven files. The patient hears 29 digits at one per second and taps every time they hear **1**.

### `digit-0.mp3` … `digit-9.mp3`

One file per digit, one word each:

| File | Say | File | Say |
|---|---|---|---|
| `digit-0.mp3` | ศูนย์ | `digit-5.mp3` | ห้า |
| `digit-1.mp3` | หนึ่ง | `digit-6.mp3` | หก |
| `digit-2.mp3` | สอง | `digit-7.mp3` | เจ็ด |
| `digit-3.mp3` | สาม | `digit-8.mp3` | แปด |
| `digit-4.mp3` | สี่ | `digit-9.mp3` | เก้า |

**Trim each file tight, and keep it under 800 ms.** Unlike `digits-forward.mp3`, pacing is not
your job here — the app supplies the rhythm and plays these at exactly one per second. What it
cannot fix is silence inside the file:

- **Leading silence** shifts that digit's real onset later than its scheduled one, and the app
  scores the difference as patient reaction time.
- **Trailing length past 800 ms** overlaps the next digit. This matters most at the run of three
  consecutive `1`s, where the same file plays three times in a row.

`digit-7.mp3` (เจ็ด) is **not used** — the sequence contains no 7. Record it anyway; it is one
extra word, and it means a later correction to the sequence does not send you back to the
microphone for a single file.

### `instr-vigilance.mp3`

> คุณจะได้ยินตัวเลขหลายตัว ให้เคาะปุ่มทุกครั้งที่ได้ยินเลข 1

Normal conversational pace, like the other instruction files.

### The sequence itself is not recorded

```
5 2 1 3 9 4 1 1 8 0 6 2 1 5 1 9 4 5 1 1 1 4 1 9 0 5 1 1 2
```

The app plays it from the ten digit files at exact one-second onsets. It lives in `subtests.js`,
came from your paper form, and a single wrong digit changes every score the subtest produces
while looking completely normal — so **read it back against the form once.** The tests catch a
dropped or added digit; nothing but your eyes catches a transposed one.
```

- [ ] **Step 2: Update the audio README**

In `src/renderer/public/moca/audio/README.md`, add beneath the existing required-files list:

```
Vigilance (11 files):
  digit-0.mp3 .. digit-9.mp3  one Thai word each, trimmed tight, under 800ms
  instr-vigilance.mp3         the spoken instruction
  The app schedules these at one per second - do not record the sequence itself.
```

- [ ] **Step 3: Update the handout**

In `handout.md`, the "Current state" table and the "Not built" paragraph are both stale — they
predate Serial 7s. Update the table to add:

```markdown
| Serial 7s | 3 | scored on the non-linear band table, against what the patient said |
| Vigilance | 1 | 29 digits at 1/sec, tap on 1 — the only non-voice subtest |
```

Set the header count to **7 of 13 subtests, 20 of 30 points**, and reduce "Not built" to:
sentence repetition (2), verbal fluency (1), abstraction (2) — 5 voice points — plus the three
pen subtests owned by teammates.

Under "Next steps", replace the completed Serial 7s item so Abstraction (2 pts) leads, and add to
the audio gap: `instr-serial-sevens.mp3`, `instr-vigilance.mp3`, and `digit-0..9.mp3` are all
unrecorded, so both new Attention subtests reach the error screen until they exist.

Add to "Known gotchas":

```markdown
6. **Vigilance owns its own timing.** The app schedules ten per-digit files at exact one-second
   onsets rather than playing one long take, because the score depends entirely on which
   one-second window a tap landed in. Do not "simplify" this into a single recording — the
   onsets would become hand-measured estimates that need re-measuring on every re-record.
```

- [ ] **Step 4: Verify nothing in the docs contradicts the code**

Run:

```bash
grep -rn "vigilance\|digit-[0-9]\.mp3" docs/ handout.md src/renderer/public/moca/audio/README.md
```

Expected: every filename mentioned matches `moca/audio/digit-N.mp3` and `moca/audio/instr-vigilance.mp3` exactly, and no doc still lists vigilance as unbuilt or as a letter task.

- [ ] **Step 5: Commit**

```bash
git add docs/moca-audio-recording-script.md src/renderer/public/moca/audio/README.md handout.md
git commit -m "docs: script the vigilance digit recordings"
```

---

## Final Verification

- [ ] **Run everything**

Run: `npm run test:all`

Expected: all Vitest tests plus the 10 pytest sidecar tests, exit code 0. Check the exit code — a leaked unhandled rejection produces `Errors 1 error` and a non-zero exit while every assertion passes.

- [ ] **Run the build**

Run: `npm run build`

Expected: clean.

- [ ] **Confirm the manual gap**

Vigilance cannot be run end to end until the eleven audio files exist. Until then it reaches the
error screen and is skippable, exactly like Serial 7s without `instr-serial-sevens.mp3`. Report
this as an outstanding item rather than as a passing subtest — a subtest that has never been
heard by a human is not verified, however green the tests are.

Once the files exist, the one measurement worth taking is a real run with a stopwatch: confirm
the sequence takes 30 seconds end to end. If it runs long, timer jitter is real on the demo
hardware and the fix is scheduling through the Web Audio API's sample clock instead of
`setTimeout` — see "Known Risks" in the spec.
