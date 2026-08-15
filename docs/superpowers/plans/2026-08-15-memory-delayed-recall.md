# Memory, Delayed Recall, and Stimulus Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MoCA Memory (two registration trials plus delayed recall, 5 points) and give Digit Span the stimulus audio it has always needed, by introducing an audio-playback phase to the session pipeline.

**Architecture:** A new injectable `AudioPlayer` mirrors the existing `AudioRecorder`. `useSubtestSession` gains a `stimulus` phase: when a subtest declares an `audio` field, `beginRecording()` plays it to completion *before* opening the microphone. One new scorer file holds both memory scorers over a shared word list. Results gain a `completedAt` timestamp so the registration→recall interval can be measured and displayed.

**Tech Stack:** Existing — Electron + React, Vitest + @testing-library/react. No new dependencies; the browser `Audio` element is injected so tests never play real sound.

**Spec:** [`docs/superpowers/specs/2026-08-15-memory-delayed-recall-design.md`](../specs/2026-08-15-memory-delayed-recall-design.md)

## Global Constraints

- **The microphone must never open before the stimulus has finished playing.** If recording overlaps playback the ASR transcribes the prompt itself and Digit Span "passes" while measuring nothing. This is the single most important property in this plan.
- MoCA awards **0 points** for both registration trials. Only delayed recall scores, and its maximum is **5**. Do not inflate the 30-point total.
- The five Thai words, verbatim and in this order: `หน้า`, `ผ้าไหม`, `วัด`, `มะลิ`, `สีแดง`.
- Registration and delayed recall must check an identical word list. They share one constant in one file so they cannot drift.
- Delayed recall has **no** audio — the patient recalls unprompted.
- The recall interval is **measured and displayed, never enforced**. No blocking wait screen.
- Playback failure routes to the existing `error` phase with Retry. Never *silently* skip a subtest, which would score 0 for something never administered. Task 9 adds an explicit, operator-initiated Skip that records the subtest as not-administered — that is a deliberate action with an honest record, not a silent fallthrough.
- Do not modify any file under `src/main/asr/`, and do not modify `src/main/scoring/matchers.js`, `naming.js`, `digitSpan.js`, or `orientation.js`.
- Full suite must exit 0. A passing assertion count with `Errors 1 error` is a failure — check the exit code.

---

## File Structure

```
src/renderer/src/moca/
  AudioPlayer.js              (NEW — injectable wrapper around Audio)
  AudioPlayer.test.js         (NEW)
  useSubtestSession.js        (MODIFY — stimulus phase, completedAt)
  useSubtestSession.test.js   (MODIFY)
  subtests.js                 (MODIFY — 3 new entries, audio on Digit Span)
  SessionRunner.jsx           (MODIFY — wire player, render stimulus phase)
src/main/scoring/
  memoryWords.js              (NEW — both memory scorers, shared word list)
  memoryWords.test.js         (NEW)
  index.js                    (MODIFY — dispatch two new scorer ids)
  index.test.js               (MODIFY)
src/renderer/src/pages/
  SessionResults.jsx          (MODIFY — informational rows, recall interval)
  SessionResults.test.jsx     (MODIFY)
```

Task order builds bottom-up: the scorer and the player are independent leaves, then the hook joins them, then the UI surfaces the results.

---

### Task 1: Memory word scorer

**Files:**
- Create: `src/main/scoring/memoryWords.js`
- Test: `src/main/scoring/memoryWords.test.js`

**Interfaces:**
- Consumes: `normalizeText`, `keywordMatch` from `./matchers.js` (existing, unchanged).
- Produces: `scoreMemoryRegistration(transcript): { score: 0, maxScore: 0, recalledCount, results }` and `scoreDelayedRecall(transcript): { score, maxScore: 5, recalledCount, results }` — both used by the dispatcher in Task 2.

Follow the exact shape of the existing `src/main/scoring/naming.js`: a module-level constant mapping keys to accepted-term arrays, then a loop using `keywordMatch`.

- [ ] **Step 1: Write the failing tests**

Create `src/main/scoring/memoryWords.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { scoreMemoryRegistration, scoreDelayedRecall } from './memoryWords.js'

const ALL_FIVE = 'หน้า ผ้าไหม วัด มะลิ สีแดง'

describe('scoreDelayedRecall', () => {
  it('awards 5/5 when every word is recalled', () => {
    const result = scoreDelayedRecall(ALL_FIVE)
    expect(result.score).toBe(5)
    expect(result.maxScore).toBe(5)
    expect(result.recalledCount).toBe(5)
  })

  it('awards partial credit and reports which words were missed', () => {
    const result = scoreDelayedRecall('หน้า วัด สีแดง')
    expect(result.score).toBe(3)
    expect(result.results.face.correct).toBe(true)
    expect(result.results.silk.correct).toBe(false)
    expect(result.results.temple.correct).toBe(true)
    expect(result.results.jasmine.correct).toBe(false)
    expect(result.results.red.correct).toBe(true)
  })

  it('awards 0/5 for an unrelated answer', () => {
    const result = scoreDelayedRecall('ไม่ทราบ')
    expect(result.score).toBe(0)
    expect(result.recalledCount).toBe(0)
  })

  it('matches an unbroken transcript with no spaces between words', () => {
    // Thai does not space between words, so Whisper may return one run-on
    // string. Substring matching must still find all five.
    const result = scoreDelayedRecall('หน้าผ้าไหมวัดมะลิสีแดง')
    expect(result.score).toBe(5)
  })

  it('accepts tonal near-homophones of หน้า that Whisper commonly produces', () => {
    expect(scoreDelayedRecall('นา').results.face.correct).toBe(true)
    expect(scoreDelayedRecall('น่า').results.face.correct).toBe(true)
  })

  it('accepts the shortened forms patients actually say', () => {
    expect(scoreDelayedRecall('แดง').results.red.correct).toBe(true)
    expect(scoreDelayedRecall('ไหม').results.silk.correct).toBe(true)
  })
})

describe('scoreMemoryRegistration', () => {
  it('scores zero regardless of how many words came back', () => {
    const result = scoreMemoryRegistration(ALL_FIVE)
    expect(result.score).toBe(0)
    expect(result.maxScore).toBe(0)
  })

  it('still reports how many words were repeated', () => {
    expect(scoreMemoryRegistration(ALL_FIVE).recalledCount).toBe(5)
    expect(scoreMemoryRegistration('หน้า วัด').recalledCount).toBe(2)
    expect(scoreMemoryRegistration('ไม่ทราบ').recalledCount).toBe(0)
  })

  it('reports per-word results like the recall scorer does', () => {
    const result = scoreMemoryRegistration('มะลิ')
    expect(result.results.jasmine.correct).toBe(true)
    expect(result.results.face.correct).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/scoring/memoryWords.test.js`
Expected: FAIL — `memoryWords.js` doesn't exist yet.

- [ ] **Step 3: Implement `memoryWords.js`**

Create `src/main/scoring/memoryWords.js`:
```js
import { normalizeText, keywordMatch } from './matchers.js'

// The five words on the Thai MoCA-Basic form, in reading order:
// หน้า (face), ผ้าไหม (silk), วัด (temple), มะลิ (jasmine), สีแดง (red).
//
// Registration and delayed recall MUST check identical content, so they share
// this one constant rather than each holding a copy that could drift.
//
// The หน้า variants are deliberate: it is a single syllable whose tonal
// neighbours (นา field, น่า should) are common words, and Whisper's Thai is
// the weakest part of this stack. Accepting them trades a rare false positive
// for a much likelier false negative. Revisit with real recordings.
const ACCEPTED_WORD_TERMS = {
  face: ['หน้า', 'น่า', 'นา'],
  silk: ['ผ้าไหม', 'ไหม'],
  temple: ['วัด'],
  jasmine: ['มะลิ'],
  red: ['สีแดง', 'แดง']
}

function matchWords(transcript) {
  const normalized = normalizeText(transcript)
  const results = {}
  let recalledCount = 0
  for (const [word, terms] of Object.entries(ACCEPTED_WORD_TERMS)) {
    const correct = keywordMatch(normalized, terms)
    results[word] = { correct }
    if (correct) recalledCount += 1
  }
  return { recalledCount, results }
}

// MoCA awards no points for registration. The count is captured as process
// data -- it separates "never encoded" from "encoded but lost" -- but must
// not affect the total.
export function scoreMemoryRegistration(transcript) {
  const { recalledCount, results } = matchWords(transcript)
  return { score: 0, maxScore: 0, recalledCount, results }
}

export function scoreDelayedRecall(transcript) {
  const { recalledCount, results } = matchWords(transcript)
  return { score: recalledCount, maxScore: 5, recalledCount, results }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/scoring/memoryWords.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/scoring/memoryWords.js src/main/scoring/memoryWords.test.js
git commit -m "feat: add memory registration and delayed recall scorers"
```

---

### Task 2: Register the memory scorers with the dispatcher

**Files:**
- Modify: `src/main/scoring/index.js`
- Modify: `src/main/scoring/index.test.js`

**Interfaces:**
- Consumes: `scoreMemoryRegistration`, `scoreDelayedRecall` (Task 1).
- Produces: `scoreItem('memory-registration', ...)` and `scoreItem('delayed-recall', ...)` — the ids `useSubtestSession` will pass as `currentSubtest.scorerId` in Task 5.

- [ ] **Step 1: Add the failing dispatcher tests**

In `src/main/scoring/index.test.js`, add these two tests inside the existing `describe('scoreItem', ...)` block, immediately before the `'throws for an unknown subtest id'` test:
```js
  it('dispatches to the memory registration scorer, which never scores points', () => {
    const result = scoreItem('memory-registration', 'หน้า ผ้าไหม วัด มะลิ สีแดง', {})
    expect(result.score).toBe(0)
    expect(result.maxScore).toBe(0)
    expect(result.recalledCount).toBe(5)
  })

  it('dispatches to the delayed recall scorer, which scores out of 5', () => {
    const result = scoreItem('delayed-recall', 'หน้า วัด สีแดง', {})
    expect(result.score).toBe(3)
    expect(result.maxScore).toBe(5)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/main/scoring/index.test.js`
Expected: FAIL — both new tests throw `No scorer registered for subtest "memory-registration"` / `"delayed-recall"`.

- [ ] **Step 3: Add the dispatcher cases**

In `src/main/scoring/index.js`, add this import below the existing `digitSpan` import:
```js
import { scoreMemoryRegistration, scoreDelayedRecall } from './memoryWords.js'
```

Then add these two cases to the `switch`, immediately before the `default:` case:
```js
    case 'memory-registration':
      return scoreMemoryRegistration(transcript)
    case 'delayed-recall':
      return scoreDelayedRecall(transcript)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/main/scoring/index.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/scoring/index.js src/main/scoring/index.test.js
git commit -m "feat: dispatch memory registration and delayed recall"
```

---

### Task 3: Audio player

**Files:**
- Create: `src/renderer/src/moca/AudioPlayer.js`
- Test: `src/renderer/src/moca/AudioPlayer.test.js`

**Interfaces:**
- Produces: `createAudioPlayer({ audioClass? }): { play(src): Promise<void> }` — used by `useSubtestSession` (Task 5) via `SessionRunner` (Task 6). `audioClass` is injectable so tests never play real audio, mirroring how `createAudioRecorder` injects `mediaRecorderClass`.

The promise resolves on the audio element's `ended` event and rejects on `error`. `Audio.play()` itself returns a promise that rejects when playback is blocked; that rejection must propagate too.

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/moca/AudioPlayer.test.js`:
```js
import { describe, it, expect, vi } from 'vitest'
import { createAudioPlayer } from './AudioPlayer.js'

class FakeAudio {
  constructor(src) {
    this.src = src
    FakeAudio.last = this
  }
  play() {
    return Promise.resolve()
  }
}

describe('createAudioPlayer', () => {
  it('resolves when the audio finishes playing', async () => {
    const player = createAudioPlayer({ audioClass: FakeAudio })
    const pending = player.play('memory-words.mp3')

    expect(FakeAudio.last.src).toBe('memory-words.mp3')
    FakeAudio.last.onended()

    await expect(pending).resolves.toBeUndefined()
  })

  it('does not resolve before the audio has ended', async () => {
    const player = createAudioPlayer({ audioClass: FakeAudio })
    const settled = vi.fn()
    player.play('memory-words.mp3').then(settled)

    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
  })

  it('rejects with a descriptive error when playback errors', async () => {
    const player = createAudioPlayer({ audioClass: FakeAudio })
    const pending = player.play('missing.mp3')

    FakeAudio.last.onerror()

    await expect(pending).rejects.toThrow('Failed to play stimulus audio: missing.mp3')
  })

  it('rejects when the browser refuses to start playback', async () => {
    class BlockedAudio extends FakeAudio {
      play() {
        return Promise.reject(new Error('NotAllowedError'))
      }
    }
    const player = createAudioPlayer({ audioClass: BlockedAudio })

    await expect(player.play('blocked.mp3')).rejects.toThrow('NotAllowedError')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/moca/AudioPlayer.test.js`
Expected: FAIL — `AudioPlayer.js` doesn't exist yet.

- [ ] **Step 3: Implement `AudioPlayer.js`**

Create `src/renderer/src/moca/AudioPlayer.js`:
```js
export function createAudioPlayer({ audioClass = Audio } = {}) {
  function play(src) {
    return new Promise((resolve, reject) => {
      const audio = new audioClass(src)
      audio.onended = () => resolve()
      audio.onerror = () => reject(new Error(`Failed to play stimulus audio: ${src}`))
      // play() rejects when the browser blocks playback (e.g. no user gesture).
      // Propagate that rather than hanging forever waiting for `ended`.
      const started = audio.play()
      if (started && typeof started.catch === 'function') started.catch(reject)
    })
  }

  return { play }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/moca/AudioPlayer.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/moca/AudioPlayer.js src/renderer/src/moca/AudioPlayer.test.js
git commit -m "feat: add injectable audio player for subtest stimuli"
```

---

### Task 4: Subtest metadata

**Files:**
- Modify: `src/renderer/src/moca/subtests.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: three new `SUBTESTS` entries (`memory-registration-1`, `memory-registration-2`, `delayed-recall`) and an `audio` field on both Digit Span entries — consumed by `useSubtestSession` (Task 5) and `SessionResults` (Task 7).

No test — this is static data, exactly like the existing entries.

**Audio must live in the Vite public directory, not next to the images.** The Naming images are `import`ed because they exist; Vite resolves and hashes them at build time. The audio files do not exist yet, and a missing `import` is a hard build failure — so they cannot use the same mechanism. Files under `src/renderer/src/assets/` are reachable *only* by import, so a plain string path pointing there would 404.

Vite serves `<root>/public` at the URL root and copies it into the build verbatim, with no import required. This project's renderer root is `src/renderer/` (where `index.html` lives), so the public directory is `src/renderer/public/`. A missing file there is a runtime 404 rather than a build error, which routes to the error phase with Retry — visible, not silent.

- [ ] **Step 1: Create the public audio directory and add the path constants**

Create the directory and a note for the user:
```bash
mkdir -p src/renderer/public/moca/audio
```

Create `src/renderer/public/moca/audio/README.md`:
```
Stimulus audio, served by Vite at /moca/audio/<name>.mp3

  memory-words.mp3     หน้า ผ้าไหม วัด มะลิ สีแดง  (one word per second, flat tone)
  digits-forward.mp3   2 1 8 5 4                    (one digit per second, no grouping)
  digits-backward.mp3  7 4 2                        (the patient answers 247 - record the prompt)

These live here rather than in src/assets because they are referenced by URL,
not imported: a missing import would fail the build, while a missing file here
is a runtime error the app reports and offers to retry.
```

Then in `src/renderer/src/moca/subtests.js`, add below the three existing image imports:
```js
// Served from src/renderer/public, so these are URL paths rather than imports.
// See this task's note: an import of a not-yet-recorded file fails the build,
// while a missing file here is a runtime error the app surfaces with Retry.
const MEMORY_WORDS_AUDIO = '/moca/audio/memory-words.mp3'
const DIGITS_FORWARD_AUDIO = '/moca/audio/digits-forward.mp3'
const DIGITS_BACKWARD_AUDIO = '/moca/audio/digits-backward.mp3'
```

- [ ] **Step 2: Add `audio` to both Digit Span entries**

In the `digit-span-forward` entry, add after `scorerId`:
```js
    audio: DIGITS_FORWARD_AUDIO,
```

In the `digit-span-backward` entry, add after `scorerId`:
```js
    audio: DIGITS_BACKWARD_AUDIO,
```

Leave `expectedSequence` on both entries exactly as it is.

- [ ] **Step 3: Insert the two registration trials**

Insert these two entries **immediately after the `naming` entry** and before `digit-span-forward`:
```js
  {
    id: 'memory-registration-1',
    section: 'Memory (trial 1)',
    instructionTextEn:
      'Listen carefully to five words. When they finish, repeat as many as you can.',
    instructionTextTh: 'ตั้งใจฟังคำห้าคำ เมื่อจบแล้ว ให้พูดทวนให้ได้มากที่สุด',
    countdownSec: 0,
    timeLimitSec: 30,
    scorerId: 'memory-registration',
    audio: MEMORY_WORDS_AUDIO
  },
  {
    id: 'memory-registration-2',
    section: 'Memory (trial 2)',
    instructionTextEn: 'Listen to the same five words again, then repeat as many as you can.',
    instructionTextTh: 'ฟังคำทั้งห้าอีกครั้ง แล้วพูดทวนให้ได้มากที่สุด',
    countdownSec: 0,
    timeLimitSec: 30,
    scorerId: 'memory-registration',
    audio: MEMORY_WORDS_AUDIO
  },
```

Both share `scorerId` and `audio` and differ only in `id` and `section`. The distinct sections matter: `SessionResults` labels rows by `section`, so two rows both reading "Memory" would be indistinguishable.

- [ ] **Step 4: Insert the delayed recall entry**

Insert this entry **immediately after `digit-span-backward`** and before `orientation`:
```js
  {
    id: 'delayed-recall',
    section: 'Delayed Recall',
    instructionTextEn: 'Tell me as many of those five words as you can remember.',
    instructionTextTh: 'บอกคำทั้งห้าคำที่จำได้ให้มากที่สุด',
    countdownSec: 0,
    timeLimitSec: 30,
    scorerId: 'delayed-recall'
  },
```

It has **no** `audio` field — the patient recalls unprompted; playing the words would defeat the subtest. Placing it before `orientation` matches the real instrument and puts it as far from registration as the current subtest set allows.

- [ ] **Step 5: Verify the resulting order and that nothing broke**

Run: `npm test; echo "exit=$?"`
Expected: all existing tests still pass, exit=0. Nothing reads the new entries yet.

Then confirm the order is exactly:
`naming → memory-registration-1 → memory-registration-2 → digit-span-forward → digit-span-backward → delayed-recall → orientation`

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/moca/subtests.js src/renderer/public/moca/audio/README.md
git commit -m "feat: add memory subtests and digit span stimulus audio metadata"
```

Also delete the now-misleading placeholder note that pointed at the wrong directory:

```bash
git rm src/renderer/src/assets/moca/audio/README.md
git commit -m "chore: point audio placement at the public directory"
```

---

### Task 5: Stimulus phase in the session hook

**Files:**
- Modify: `src/renderer/src/moca/useSubtestSession.js`
- Modify: `src/renderer/src/moca/useSubtestSession.test.js`

**Interfaces:**
- Consumes: a `playAudio(src): Promise<void>` dependency shaped like `createAudioPlayer(...).play` (Task 3); `SUBTESTS` entries that may carry `audio` (Task 4).
- Produces: the `'stimulus'` phase and a `completedAt` field on every entry in `results` — consumed by `SessionRunner` (Task 6) and `SessionResults` (Task 7).

**This task carries the plan's most important property.** The microphone must not open until playback has resolved. The ordering test below is the guard; without it, Digit Span would transcribe its own prompt and appear to pass while measuring nothing.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/moca/useSubtestSession.test.js`, replace the existing `setup()` function with this version, which adds a `playAudio` fake and a shared call log:
```js
function setup() {
  const callOrder = []
  const fakeRecorder = {
    start: vi.fn().mockImplementation(async () => {
      callOrder.push('recorder.start')
    }),
    stop: vi.fn().mockResolvedValue(new Blob(['x']))
  }
  const createRecorder = vi.fn(() => fakeRecorder)
  const playAudio = vi.fn().mockImplementation(async () => {
    callOrder.push('playAudio')
  })
  const transcribeAudio = vi.fn().mockResolvedValue({ text: 'สิงโต แรด อูฐ', engine: 'local' })
  const scoreItem = vi.fn().mockResolvedValue({ score: 3, maxScore: 3 })
  return { fakeRecorder, createRecorder, playAudio, transcribeAudio, scoreItem, callOrder }
}
```

Then add this new `describe` block at the end of the file:
```js
describe('useSubtestSession stimulus playback', () => {
  const withAudio = [{ id: 'digit-span-forward', scorerId: 'digit-span-forward', audio: 'digits.mp3' }]
  const withoutAudio = [{ id: 'orientation', scorerId: 'orientation' }]

  it('plays the stimulus to completion BEFORE opening the microphone', async () => {
    const deps = setup()
    const { result } = renderHook(() => useSubtestSession(withAudio, deps))

    await act(async () => {
      await result.current.beginRecording()
    })

    expect(deps.playAudio).toHaveBeenCalledWith('digits.mp3')
    // The guarantee: if these ever invert, the mic records the prompt and the
    // ASR transcribes the app's own voice.
    expect(deps.callOrder).toEqual(['playAudio', 'recorder.start'])
  })

  it('skips playback entirely for subtests with no audio', async () => {
    const deps = setup()
    const { result } = renderHook(() => useSubtestSession(withoutAudio, deps))

    await act(async () => {
      await result.current.beginRecording()
    })

    expect(deps.playAudio).not.toHaveBeenCalled()
    expect(result.current.phase).toBe('recording')
  })

  it('routes a playback failure to the error phase rather than recording anyway', async () => {
    const deps = setup()
    deps.playAudio.mockRejectedValue(new Error('Failed to play stimulus audio: digits.mp3'))
    const { result } = renderHook(() => useSubtestSession(withAudio, deps))

    await act(async () => {
      await result.current.beginRecording()
    })

    expect(result.current.phase).toBe('error')
    expect(result.current.error).toContain('Failed to play stimulus audio')
    expect(deps.fakeRecorder.start).not.toHaveBeenCalled()
  })

  it('stamps each result with the time it completed', async () => {
    const deps = setup()
    const { result } = renderHook(() => useSubtestSession(withoutAudio, deps))
    const before = Date.now()

    await act(async () => {
      await result.current.beginRecording()
      await result.current.finishRecording()
    })

    const { completedAt } = result.current.results[0]
    expect(typeof completedAt).toBe('number')
    expect(completedAt).toBeGreaterThanOrEqual(before)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/moca/useSubtestSession.test.js`
Expected: FAIL — the hook does not destructure `playAudio`, never plays anything, and results carry no `completedAt`.

- [ ] **Step 3: Add playback and the timestamp**

In `src/renderer/src/moca/useSubtestSession.js`, change the destructured dependency parameter from:
```js
  { transcribeAudio, scoreItem, createRecorder },
```
to:
```js
  { transcribeAudio, scoreItem, createRecorder, playAudio },
```

Replace the whole `beginRecording` callback with:
```js
  const beginRecording = useCallback(async () => {
    try {
      // The mic must not open until the stimulus has finished. If these
      // overlap, the recording captures the prompt and the ASR transcribes
      // the app's own voice -- the subtest would appear to pass while
      // measuring nothing.
      if (currentSubtest.audio) {
        setPhase('stimulus')
        await playAudio(currentSubtest.audio)
      }
      recorderRef.current = createRecorder()
      await recorderRef.current.start()
      setPhase('recording')
    } catch (err) {
      setError(err.message)
      setPhase('error')
    }
  }, [currentSubtest, createRecorder, playAudio])
```

Then, in `finishRecording`, change the `setResults` call from:
```js
      setResults((prev) => [
        ...prev,
        { subtestId: currentSubtest.id, transcript, engine, ...scoreResult }
      ])
```
to:
```js
      setResults((prev) => [
        ...prev,
        {
          subtestId: currentSubtest.id,
          transcript,
          engine,
          completedAt: Date.now(),
          ...scoreResult
        }
      ])
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/moca/useSubtestSession.test.js`
Expected: PASS. The pre-existing tests in this file still pass because `setup()` now supplies `playAudio` and none of their subtests declare `audio`.

- [ ] **Step 5: Run the full suite**

Run: `npm test; echo "exit=$?"`
Expected: exit=0, no `Errors` line.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/moca/useSubtestSession.js src/renderer/src/moca/useSubtestSession.test.js
git commit -m "feat: play subtest stimulus audio before opening the microphone"
```

---

### Task 6: Wire the player into the app

**Files:**
- Modify: `src/renderer/src/moca/SessionRunner.jsx`

**Interfaces:**
- Consumes: `createAudioPlayer` (Task 3), the `'stimulus'` phase (Task 5).
- Produces: the running app. No later task consumes this.

No automated test — `SessionRunner.jsx` has no test file, by the same reasoning as Plan 1's integration task. Verified by reading and by `npm run build`.

- [ ] **Step 1: Import and inject the player**

In `src/renderer/src/moca/SessionRunner.jsx`, add this import below the `createAudioRecorder` import:
```jsx
import { createAudioPlayer } from './AudioPlayer.js'
```

Add this constant immediately below the `ASR_LABELS` object:
```jsx
// Created once at module scope: it holds no state between calls, and a new
// instance per render would be pointless churn.
const audioPlayer = createAudioPlayer()
```

Then add `playAudio` to the dependency object passed to `useSubtestSession`, after `createRecorder`:
```jsx
      createRecorder: createAudioRecorder,
      playAudio: (src) => audioPlayer.play(src)
```

- [ ] **Step 2: Render the stimulus phase**

In the returned JSX, replace this line:
```jsx
      {phase === 'instruction' && <button onClick={beginRecording}>Start</button>}
```
with:
```jsx
      {phase === 'instruction' && <button onClick={beginRecording}>Start</button>}
      {phase === 'stimulus' && <p>Listen…</p>}
```

The Start button already disappears outside the `instruction` phase, so there is no way to re-trigger playback mid-prompt.

- [ ] **Step 3: Verify the build**

Run: `npm run build; echo "exit=$?"`
Expected: exit=0.

Run: `npm test; echo "exit=$?"`
Expected: exit=0, unchanged test count.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/moca/SessionRunner.jsx
git commit -m "feat: wire the audio player into the session UI"
```

---

### Task 7: Results display — informational rows and the recall interval

**Files:**
- Modify: `src/renderer/src/pages/SessionResults.jsx`
- Modify: `src/renderer/src/pages/SessionResults.test.jsx`

**Interfaces:**
- Consumes: `results` entries carrying `recalledCount`, `maxScore: 0`, and `completedAt` (Tasks 1 and 5).
- Produces: the final score table. No later task consumes this.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/pages/SessionResults.test.jsx`, extend the `subtests` fixture at the top of the file to:
```jsx
const subtests = [
  { id: 'naming', section: 'Naming' },
  { id: 'orientation', section: 'Orientation' },
  { id: 'memory-registration-2', section: 'Memory (trial 2)' },
  { id: 'delayed-recall', section: 'Delayed Recall' }
]
```

Then add this new `describe` block at the end of the file:
```jsx
describe('SessionResults memory rows and recall interval', () => {
  const registration = {
    subtestId: 'memory-registration-2',
    score: 0,
    maxScore: 0,
    recalledCount: 3,
    engine: 'local',
    completedAt: 1_000_000
  }
  const recall = {
    subtestId: 'delayed-recall',
    score: 4,
    maxScore: 5,
    recalledCount: 4,
    engine: 'local',
    completedAt: 1_000_000 + 160_000 // 2m 40s later
  }

  it('shows the recalled count instead of a score for unscored rows', () => {
    render(<SessionResults results={[registration]} subtests={subtests} />)
    expect(screen.getByText('3 of 5 recalled')).toBeInTheDocument()
  })

  it('excludes unscored rows from the total', () => {
    render(<SessionResults results={[registration, recall]} subtests={subtests} />)
    // Only the recall contributes: 4 / 5, not 4 / 5 plus a 0 / 0 row.
    expect(screen.getByText('Total: 4 / 5')).toBeInTheDocument()
  })

  it('reports how long after registration the recall happened', () => {
    render(<SessionResults results={[registration, recall]} subtests={subtests} />)
    expect(screen.getByText(/Delayed recall after 2m 40s/)).toBeInTheDocument()
  })

  it('warns when the interval is under the five minute protocol gap', () => {
    render(<SessionResults results={[registration, recall]} subtests={subtests} />)
    expect(screen.getByText(/under the 5 minute protocol interval/)).toBeInTheDocument()
  })

  it('omits the interval entirely when registration or recall is missing', () => {
    render(<SessionResults results={[recall]} subtests={subtests} />)
    expect(screen.queryByText(/Delayed recall after/)).not.toBeInTheDocument()
  })

  it('does not warn when the interval meets the protocol gap', () => {
    const lateRecall = { ...recall, completedAt: 1_000_000 + 400_000 } // 6m 40s
    render(<SessionResults results={[registration, lateRecall]} subtests={subtests} />)
    expect(screen.getByText(/Delayed recall after 6m 40s/)).toBeInTheDocument()
    expect(screen.queryByText(/under the 5 minute/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/pages/SessionResults.test.jsx`
Expected: FAIL — no recalled-count rendering and no interval line exist yet.

- [ ] **Step 3: Implement the changes**

Replace the whole contents of `src/renderer/src/pages/SessionResults.jsx` with:
```jsx
const PROTOCOL_RECALL_GAP_MS = 5 * 60 * 1000

function formatGap(ms) {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds}s`
}

// MoCA expects roughly five minutes between the last registration trial and
// delayed recall. We measure rather than enforce -- a blocking wait reads as a
// hung app -- so the interval is displayed and flagged when it falls short.
function recallInterval(results) {
  const registration = results.find((r) => r.subtestId === 'memory-registration-2')
  const recall = results.find((r) => r.subtestId === 'delayed-recall')
  if (!registration?.completedAt || !recall?.completedAt) return null

  const elapsedMs = recall.completedAt - registration.completedAt
  return { text: formatGap(elapsedMs), short: elapsedMs < PROTOCOL_RECALL_GAP_MS }
}

export function SessionResults({ results, subtests }) {
  const total = results.reduce((sum, r) => sum + r.score, 0)
  const maxTotal = results.reduce((sum, r) => sum + r.maxScore, 0)
  const interval = recallInterval(results)

  return (
    <div className="session-results">
      <h2>MoCA Session Results</h2>
      <table>
        <thead>
          <tr>
            <th>Subtest</th>
            <th>Score</th>
            <th>Engine</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const subtest = subtests.find((s) => s.id === r.subtestId)
            // MoCA awards no points for memory registration, so those rows
            // report the count as information rather than as a score.
            const unscored = r.maxScore === 0 && r.recalledCount !== undefined
            return (
              <tr key={r.subtestId}>
                <td>{subtest ? subtest.section : r.subtestId}</td>
                <td>
                  {unscored ? `${r.recalledCount} of 5 recalled` : `${r.score} / ${r.maxScore}`}
                </td>
                <td>{r.engine ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="total">
        Total: {total} / {maxTotal}
      </p>
      {interval && (
        <p className="recall-interval">
          Delayed recall after {interval.text}
          {interval.short && ' — under the 5 minute protocol interval, so this score is not comparable to published norms'}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/pages/SessionResults.test.jsx`
Expected: PASS, 9 tests (the 3 existing plus the 6 new).

- [ ] **Step 5: Run the full suite and build**

Run: `npm test; echo "exit=$?"`
Expected: exit=0, no `Errors` line.

Run: `npm run build; echo "exit=$?"`
Expected: exit=0.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/pages/SessionResults.jsx src/renderer/src/pages/SessionResults.test.jsx
git commit -m "feat: report memory registration counts and the recall interval"
```

---

### Task 9: Skip control for the error phase

**Files:**
- Modify: `src/renderer/src/moca/useSubtestSession.js`
- Modify: `src/renderer/src/moca/useSubtestSession.test.js`
- Modify: `src/renderer/src/moca/SessionRunner.jsx`
- Modify: `src/renderer/src/pages/SessionResults.jsx`
- Modify: `src/renderer/src/pages/SessionResults.test.jsx`

**Interfaces:**
- Consumes: the `error` phase and `retryRecording` (existing), `completedAt` on results (Task 5).
- Produces: `skipSubtest()` from the hook, and `skipped: true` entries in `results` — rendered by `SessionResults`.

**Why this exists.** The `error` phase currently offers Retry only. Once Task 4 gives Memory and Digit Span `audio` fields pointing at files that may not exist yet, a failed playback becomes unrecoverable: Retry re-attempts the same missing file forever and the session cannot reach the subtests after it. A Skip is also independently useful — an operator may need to abandon a subtest for reasons unrelated to audio, such as patient distress or equipment failure.

**A skipped subtest scores nothing, and is not scored 0.** Scoring 0 asserts the patient failed; skipping asserts the subtest was never administered. Those are clinically different claims. A skipped entry therefore carries `maxScore: 0`, contributing to neither side of the total, and the results table says so — otherwise a session with skipped subtests would quietly report a total that looks comparable to the 30-point scale when it is not.

- [ ] **Step 1: Write the failing hook test**

In `src/renderer/src/moca/useSubtestSession.test.js`, add this `describe` block at the end of the file:
```js
describe('useSubtestSession skipping', () => {
  const twoSubtests = [
    { id: 'digit-span-forward', scorerId: 'digit-span-forward', audio: 'digits.mp3' },
    { id: 'orientation', scorerId: 'orientation' }
  ]

  it('records the subtest as skipped and advances past it', async () => {
    const deps = setup()
    deps.playAudio.mockRejectedValue(new Error('Failed to play stimulus audio: digits.mp3'))
    const { result } = renderHook(() => useSubtestSession(twoSubtests, deps))

    await act(async () => {
      await result.current.beginRecording()
    })
    expect(result.current.phase).toBe('error')

    act(() => {
      result.current.skipSubtest()
    })

    expect(result.current.currentSubtest.id).toBe('orientation')
    expect(result.current.phase).toBe('instruction')
    expect(result.current.error).toBeNull()
    expect(result.current.results).toHaveLength(1)
    expect(result.current.results[0]).toMatchObject({
      subtestId: 'digit-span-forward',
      skipped: true,
      score: 0,
      maxScore: 0
    })
  })

  it('finishes the session when the last subtest is skipped', async () => {
    const deps = setup()
    const { result } = renderHook(() => useSubtestSession([twoSubtests[1]], deps))

    act(() => {
      result.current.skipSubtest()
    })

    expect(result.current.phase).toBe('done')
    expect(result.current.results).toHaveLength(1)
  })

  it('stamps a skipped result with completedAt like any other result', async () => {
    const deps = setup()
    const before = Date.now()
    const { result } = renderHook(() => useSubtestSession(twoSubtests, deps))

    act(() => {
      result.current.skipSubtest()
    })

    expect(result.current.results[0].completedAt).toBeGreaterThanOrEqual(before)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/src/moca/useSubtestSession.test.js`
Expected: FAIL — `result.current.skipSubtest` is not a function.

- [ ] **Step 3: Add `skipSubtest` to the hook**

In `src/renderer/src/moca/useSubtestSession.js`, add this callback immediately after `retryRecording`:
```js
  // A skipped subtest was never administered, so it scores nothing rather
  // than scoring 0 -- 0 would assert the patient failed. maxScore 0 keeps it
  // out of both sides of the total.
  const skipSubtest = useCallback(() => {
    setError(null)
    setResults((prev) => [
      ...prev,
      {
        subtestId: currentSubtest.id,
        skipped: true,
        score: 0,
        maxScore: 0,
        completedAt: Date.now()
      }
    ])
    if (index + 1 < subtests.length) {
      setIndex((prev) => prev + 1)
      setPhase('instruction')
    } else {
      setPhase('done')
    }
  }, [currentSubtest, index, subtests.length])
```

Then add `skipSubtest` to the returned object, after `retryRecording`:
```js
    retryRecording,
    skipSubtest
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/src/moca/useSubtestSession.test.js`
Expected: PASS.

- [ ] **Step 5: Add the Skip button**

In `src/renderer/src/moca/SessionRunner.jsx`, add `skipSubtest` to the values destructured from `useSubtestSession`, after `retryRecording`.

Then in the `phase === 'error'` block, add a Skip button beside Retry:
```jsx
        <button onClick={retryRecording}>Retry</button>
        <button onClick={skipSubtest}>Skip this subtest</button>
```

- [ ] **Step 6: Write the failing results tests**

In `src/renderer/src/pages/SessionResults.test.jsx`, add this `describe` block at the end:
```jsx
describe('SessionResults skipped subtests', () => {
  const skipped = {
    subtestId: 'naming',
    skipped: true,
    score: 0,
    maxScore: 0,
    completedAt: 1_000_000
  }
  const scored = { subtestId: 'orientation', score: 6, maxScore: 6, engine: 'local' }

  it('labels a skipped row rather than showing a score', () => {
    render(<SessionResults results={[skipped]} subtests={subtests} />)
    expect(screen.getByText('skipped')).toBeInTheDocument()
  })

  it('warns that the total is incomplete when anything was skipped', () => {
    render(<SessionResults results={[skipped, scored]} subtests={subtests} />)
    expect(screen.getByText(/1 subtest skipped/)).toBeInTheDocument()
  })

  it('says nothing about skipping when every subtest ran', () => {
    render(<SessionResults results={[scored]} subtests={subtests} />)
    expect(screen.queryByText(/subtest skipped/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/src/pages/SessionResults.test.jsx`
Expected: FAIL — skipped rows render `0 / 0` and there is no incompleteness note.

- [ ] **Step 8: Render skipped rows and the incompleteness note**

In `src/renderer/src/pages/SessionResults.jsx`, inside the `results.map` callback, change the score cell so a skipped row is labelled. Replace:
```jsx
                <td>
                  {unscored ? `${r.recalledCount} of 5 recalled` : `${r.score} / ${r.maxScore}`}
                </td>
```
with:
```jsx
                <td>
                  {r.skipped
                    ? 'skipped'
                    : unscored
                      ? `${r.recalledCount} of 5 recalled`
                      : `${r.score} / ${r.maxScore}`}
                </td>
```

Then add this above the `return`, beside the existing `interval` calculation:
```jsx
  const skippedCount = results.filter((r) => r.skipped).length
```

And add this immediately after the `<p className="total">` element:
```jsx
      {skippedCount > 0 && (
        <p className="skipped-note">
          {skippedCount} subtest{skippedCount === 1 ? '' : 's'} skipped — this total is not
          comparable to the full 30-point scale
        </p>
      )}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/src/pages/SessionResults.test.jsx`
Expected: PASS.

- [ ] **Step 10: Run the full suite and build**

Run: `npm test; echo "exit=$?"`
Expected: exit=0, no `Errors` line.

Run: `npm run build; echo "exit=$?"`
Expected: exit=0.

- [ ] **Step 11: Commit**

```bash
git add src/renderer/src/moca/useSubtestSession.js src/renderer/src/moca/useSubtestSession.test.js src/renderer/src/moca/SessionRunner.jsx src/renderer/src/pages/SessionResults.jsx src/renderer/src/pages/SessionResults.test.jsx
git commit -m "feat: let the operator skip a subtest that cannot be administered"
```

---

### Task 8: Manual end-to-end verification

**Files:** none — this task changes no code.

**Interfaces:** none.

This is the only step that exercises real audio playback and real speech. It requires the three recordings named below; without them, playback fails and the subtests route to the error phase — which is itself worth confirming, since it proves the failure path works.

**Required from the user, in `src/renderer/public/moca/audio/`** (note: the public directory, not `src/assets` — see Task 4 for why):

| File | Content |
|---|---|
| `memory-words.mp3` | หน้า ผ้าไหม วัด มะลิ สีแดง — one word per second, flat tone |
| `digits-forward.mp3` | 2 – 1 – 8 – 5 – 4 (สอง หนึ่ง แปด ห้า สี่), one digit per second |
| `digits-backward.mp3` | 7 – 4 – 2 (เจ็ด สี่ สอง) — the patient answers 247; record the prompt, not the answer |

- [ ] **Step 1: Confirm the automated suites are green**

Run: `npm run test:all; echo "exit=$?"`
Expected: Vitest passes, then pytest passes, exit=0.

- [ ] **Step 2: Verify the failure path before adding audio**

With the audio files still absent, run `npm run dev` and start the first Memory trial.

Expected: the subtest enters the error phase showing `Failed to play stimulus audio: ...` with **Retry and Skip** buttons — **not** a silent skip, and **not** a recording that scores 0. This confirms a missing stimulus can never be mistaken for a patient who said nothing.

Then press **Skip** and confirm the session advances to the next subtest. Skip past every audio-dependent subtest and reach Orientation, confirming the results table marks the skipped rows `skipped` and carries the "not comparable to the full 30-point scale" note. This is the path you will use for demos until the recordings exist.

Note this task runs **after Task 9**, which adds that Skip control — the numbering is historical, not an ordering.

- [ ] **Step 3: Add the audio files and verify playback ordering**

Drop the three recordings into `src/renderer/public/moca/audio/`, restart, and run Memory trial 1.

Confirm, in order:
1. Pressing Start shows `Listen…` and the words play.
2. The Stop & Score button appears only *after* playback finishes.
3. The transcript in the DevTools console (`F12`, the `[ASR]` line) contains **only what you said**, not the five words the app just played. If the prompt appears in the transcript, the mic opened too early — stop and report it, because every stimulus subtest would be invalid.

- [ ] **Step 4: Run the full session**

Complete all seven subtests in order. Record:
- **Registration counts** for both trials — do they rise between trial 1 and trial 2, as learning predicts?
- **Delayed recall score** and the interval shown beneath the table.
- **Whether `หน้า` scored correctly**, and what the ASR actually transcribed for it. This is the accepted-variants gamble from the spec; real data decides whether `นา`/`น่า` should stay.

- [ ] **Step 5: Record findings**

If the run shows the variant list needs changing, note it and raise it — do not silently edit the scorer, since loosening it further trades away real points.

```bash
git commit --allow-empty -m "chore: record memory subtest manual verification findings"
```

---

## What's Deliberately Out of Scope

- Cued recall (category and multiple-choice prompts). Recorded but unscored in MoCA.
- Countdown and time-limit enforcement. `countdownSec`/`timeLimitSec` remain unread, including the `timeLimitSec: 30` on the new entries.
- The remaining six subtests.
- Recording the audio files.
