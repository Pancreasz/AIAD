# Digital MoCA — Foundation & First Voice Subtests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reusable test-administration pipeline (instruction → record → transcribe → score → advance) and prove it end-to-end with four voice-only MoCA subtests: Naming, Digit Span (forward and backward), and Orientation.

**Architecture:** Electron main process owns I/O with the outside world (speech-to-text via the OpenAI Whisper API, and rule-based scoring) exposed to the renderer over IPC. The renderer owns UI/sequencing: a `useSubtestSession` state machine drives an ordered list of subtest metadata through instruction → record → score → advance, backed by a `MediaRecorder`-based `AudioRecorder`. Scoring logic is pure, deterministic, dependency-injected functions — no ML model needed for any of the four subtests in this plan — so it can be fully unit-tested without touching real audio or network calls.

**Tech Stack:** Electron + React (existing electron-vite scaffold at `D:\ad_hw`), Vitest + @testing-library/react for tests, OpenAI Whisper API for Thai/English speech-to-text, no new runtime dependencies beyond the test tooling and (implicitly) Node's built-in `fetch`/`FormData`/`Blob` in the main process.

## Global Constraints

- Instructions must be presented in both Thai and English (per design doc §4 "Test Administration App").
- Scoring for these four subtests is fully rule-based/deterministic — do not introduce a trained ML model here (design doc §4, §7 — the only ML component in the whole project is the already-existing Clock Drawing Test model, out of scope for this plan).
- Never commit API keys. `.env` must be gitignored before any task introduces a real key.
- Orientation year must be reported in Buddhist Era (CE + 543), matching the Thai MoCA form (see design doc's source form).

---

## File Structure

```
src/
  main/
    index.js                      (MODIFY — register new IPC handlers)
    asr/
      whisperClient.js            (NEW — OpenAI Whisper API client)
      whisperClient.test.js       (NEW)
    scoring/
      matchers.js                 (NEW — shared text/number matching utilities)
      matchers.test.js            (NEW)
      orientation.js              (NEW)
      orientation.test.js         (NEW)
      naming.js                   (NEW)
      naming.test.js              (NEW)
      digitSpan.js                (NEW)
      digitSpan.test.js           (NEW)
      index.js                    (NEW — scoreItem dispatcher)
      index.test.js               (NEW)
    ipc/
      asr.js                      (NEW — registers 'asr:transcribe' handler)
      scoring.js                  (NEW — registers 'scoring:score-item' handler)
  preload/
    index.js                      (MODIFY — expose transcribeAudio/scoreItem to renderer)
  renderer/src/
    moca/
      subtests.js                 (NEW — ordered metadata for the 4 subtests in scope)
      AudioRecorder.js            (NEW — MediaRecorder wrapper)
      AudioRecorder.test.js       (NEW)
      useSubtestSession.js        (NEW — sequencing state machine)
      useSubtestSession.test.js   (NEW)
      SessionRunner.jsx           (NEW — wires hook + recorder + IPC into UI)
    pages/
      SessionResults.jsx          (NEW — final score table)
      SessionResults.test.jsx     (NEW)
    App.jsx                       (MODIFY — render SessionRunner instead of boilerplate)
vitest.config.mjs                 (NEW)
package.json                     (MODIFY — add test tooling + scripts)
.gitignore                       (MODIFY — add .env)
```

---

### Task 1: Test tooling setup

**Files:**
- Create: `vitest.config.mjs`
- Create: `src/renderer/src/setupTests.js`
- Modify: `package.json`
- Modify: `.gitignore`
- Test: `src/smoke.test.js`

**Interfaces:**
- Produces: `npm test` runs Vitest once; `npm run test:watch` runs it in watch mode. Every later task's tests rely on this being in place.

- [ ] **Step 1: Add test dependencies**

Run:
```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 2: Add `.env` to `.gitignore`**

Add to `.gitignore`:
```
.env
.env.*
```

- [ ] **Step 3: Create the Vitest config**

Create `vitest.config.mjs`:
```js
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src')
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/renderer/src/setupTests.js']
  }
})
```

- [ ] **Step 4: Create the test setup file**

Create `src/renderer/src/setupTests.js`:
```js
import '@testing-library/jest-dom/vitest'
```

- [ ] **Step 5: Add test scripts to `package.json`**

In the `"scripts"` block of `package.json`, add:
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 6: Write a smoke test to confirm the harness works**

Create `src/smoke.test.js`:
```js
import { describe, it, expect } from 'vitest'

describe('test harness smoke test', () => {
  it('runs a basic assertion', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 7: Run the test suite and verify it passes**

Run: `npm test`
Expected: 1 file, 1 test, PASS. If it fails to even start, the Vitest config or plugin install is broken — fix before continuing to any other task.

- [ ] **Step 8: Commit**

```bash
git add vitest.config.mjs src/renderer/src/setupTests.js src/smoke.test.js package.json package-lock.json .gitignore
git commit -m "test: add Vitest test harness"
```

---

### Task 2: Shared text/number matching utilities

**Files:**
- Create: `src/main/scoring/matchers.js`
- Test: `src/main/scoring/matchers.test.js`

**Interfaces:**
- Produces: `normalizeText(text): string`, `exactMatch(transcript, expected): boolean`, `keywordMatch(transcript, acceptedKeywords: string[]): boolean`, `extractDigitSequence(transcript): string`, `numberSequenceMatch(transcript, expectedSequence: string): boolean` — used by every scorer task below.

- [ ] **Step 1: Write the failing tests**

Create `src/main/scoring/matchers.test.js`:
```js
import { describe, it, expect } from 'vitest'
import {
  normalizeText,
  exactMatch,
  keywordMatch,
  extractDigitSequence,
  numberSequenceMatch
} from './matchers.js'

describe('normalizeText', () => {
  it('trims, lowercases, and collapses whitespace', () => {
    expect(normalizeText('  Hello   World  ')).toBe('hello world')
  })
})

describe('exactMatch', () => {
  it('matches after normalization', () => {
    expect(exactMatch('  Hello World ', 'hello world')).toBe(true)
  })

  it('rejects different text', () => {
    expect(exactMatch('hello', 'goodbye')).toBe(false)
  })
})

describe('keywordMatch', () => {
  it('matches if any accepted keyword appears in the transcript', () => {
    expect(keywordMatch('I saw a สิงโต today', ['สิงโต', 'lion'])).toBe(true)
  })

  it('returns false if no accepted keyword appears', () => {
    expect(keywordMatch('I saw a cat', ['สิงโต', 'lion'])).toBe(false)
  })
})

describe('extractDigitSequence', () => {
  it('extracts numeric digits spoken as numerals', () => {
    expect(extractDigitSequence('2 1 8 5 4')).toBe('21854')
  })

  it('extracts digits spoken as Thai number words', () => {
    expect(extractDigitSequence('สอง หนึ่ง แปด ห้า สี่')).toBe('21854')
  })

  it('handles a mix of numerals and Thai words', () => {
    expect(extractDigitSequence('2 หนึ่ง 8 ห้า 4')).toBe('21854')
  })
})

describe('numberSequenceMatch', () => {
  it('matches when the extracted sequence equals the expected sequence', () => {
    expect(numberSequenceMatch('2 1 8 5 4', '21854')).toBe(true)
  })

  it('rejects when the sequence differs', () => {
    expect(numberSequenceMatch('2 1 8 5 5', '21854')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/scoring/matchers.test.js`
Expected: FAIL with "Failed to resolve import ./matchers.js" (file doesn't exist yet).

- [ ] **Step 3: Implement `matchers.js`**

Create `src/main/scoring/matchers.js`:
```js
export function normalizeText(text) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function exactMatch(transcript, expected) {
  return normalizeText(transcript) === normalizeText(expected)
}

export function keywordMatch(transcript, acceptedKeywords) {
  const normalized = normalizeText(transcript)
  return acceptedKeywords.some((keyword) => normalized.includes(normalizeText(keyword)))
}

const THAI_DIGIT_WORDS = {
  ศูนย์: '0',
  หนึ่ง: '1',
  สอง: '2',
  สาม: '3',
  สี่: '4',
  ห้า: '5',
  หก: '6',
  เจ็ด: '7',
  แปด: '8',
  เก้า: '9'
}

export function extractDigitSequence(transcript) {
  const normalized = normalizeText(transcript)
  const words = normalized.split(' ')
  const digits = []
  for (const word of words) {
    if (/^\d$/.test(word)) {
      digits.push(word)
    } else if (THAI_DIGIT_WORDS[word]) {
      digits.push(THAI_DIGIT_WORDS[word])
    } else {
      const embedded = word.match(/\d/g)
      if (embedded) digits.push(...embedded)
    }
  }
  return digits.join('')
}

export function numberSequenceMatch(transcript, expectedSequence) {
  return extractDigitSequence(transcript) === expectedSequence
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/scoring/matchers.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/scoring/matchers.js src/main/scoring/matchers.test.js
git commit -m "feat: add shared text and digit-sequence matching utilities"
```

---

### Task 3: Orientation scorer

**Files:**
- Create: `src/main/scoring/orientation.js`
- Test: `src/main/scoring/orientation.test.js`

**Interfaces:**
- Consumes: `keywordMatch`, `normalizeText` from `matchers.js` (Task 2).
- Produces: `scoreOrientation(transcript, context: { referenceDate: Date, place: string, province: string }): { score: number, maxScore: 6, results: object }` — used by the scoring dispatcher (Task 6).

- [ ] **Step 1: Write the failing tests**

Create `src/main/scoring/orientation.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { scoreOrientation } from './orientation.js'

describe('scoreOrientation', () => {
  const context = {
    referenceDate: new Date(2026, 7, 13), // August 13, 2026 (month is 0-indexed)
    place: 'โรงพยาบาลศิริราช',
    province: 'กรุงเทพ'
  }

  it('awards full 6/6 when all six items are stated correctly', () => {
    const transcript =
      'วันนี้วันพฤหัสบดี เดือนสิงหาคม ปี 2569 วันที่ 13 อยู่ที่โรงพยาบาลศิริราช จังหวัดกรุงเทพ'
    const result = scoreOrientation(transcript, context)
    expect(result.score).toBe(6)
    expect(result.maxScore).toBe(6)
  })

  it('awards partial credit for a partially correct answer', () => {
    const transcript = 'วันนี้วันพฤหัสบดี เดือนสิงหาคม'
    const result = scoreOrientation(transcript, context)
    expect(result.score).toBe(2)
    expect(result.results.day.correct).toBe(true)
    expect(result.results.month.correct).toBe(true)
    expect(result.results.year.correct).toBe(false)
  })

  it('reports the Buddhist Era year (CE + 543), not the Gregorian year', () => {
    const result = scoreOrientation('ปี 2569', context)
    expect(result.results.year.expected).toBe('2569')
    expect(result.results.year.correct).toBe(true)
  })

  it('awards 0/6 for an unrelated answer', () => {
    const result = scoreOrientation('ไม่ทราบ', context)
    expect(result.score).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/scoring/orientation.test.js`
Expected: FAIL — `orientation.js` doesn't exist yet.

- [ ] **Step 3: Implement `orientation.js`**

Create `src/main/scoring/orientation.js`:
```js
import { normalizeText, keywordMatch } from './matchers.js'

const THAI_MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม'
]

const THAI_DAYS = [
  'วันอาทิตย์',
  'วันจันทร์',
  'วันอังคาร',
  'วันพุธ',
  'วันพฤหัสบดี',
  'วันศุกร์',
  'วันเสาร์'
]

export function scoreOrientation(transcript, context) {
  const { referenceDate, place, province } = context
  const normalized = normalizeText(transcript)

  // Thai MoCA forms use the Buddhist Era (BE = CE + 543), not the Gregorian year.
  const items = {
    day: THAI_DAYS[referenceDate.getDay()],
    month: THAI_MONTHS[referenceDate.getMonth()],
    year: String(referenceDate.getFullYear() + 543),
    date: String(referenceDate.getDate()),
    place,
    province
  }

  const results = {}
  let score = 0
  for (const [key, expected] of Object.entries(items)) {
    const correct = keywordMatch(normalized, [expected])
    results[key] = { expected, correct }
    if (correct) score += 1
  }

  return { score, maxScore: 6, results }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/scoring/orientation.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/scoring/orientation.js src/main/scoring/orientation.test.js
git commit -m "feat: add orientation subtest scorer"
```

---

### Task 4: Naming scorer

**Files:**
- Create: `src/main/scoring/naming.js`
- Test: `src/main/scoring/naming.test.js`

**Interfaces:**
- Consumes: `normalizeText`, `keywordMatch` from `matchers.js` (Task 2).
- Produces: `scoreNaming(transcript): { score: number, maxScore: 3, results: object }` — used by the scoring dispatcher (Task 6).

- [ ] **Step 1: Write the failing tests**

Create `src/main/scoring/naming.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { scoreNaming } from './naming.js'

describe('scoreNaming', () => {
  it('awards 3/3 when all three animals are named correctly', () => {
    const result = scoreNaming('สิงโต แรด อูฐ')
    expect(result.score).toBe(3)
    expect(result.maxScore).toBe(3)
  })

  it('accepts English animal names too', () => {
    const result = scoreNaming('lion rhino camel')
    expect(result.score).toBe(3)
  })

  it('awards partial credit when only some animals are named', () => {
    const result = scoreNaming('สิงโต อูฐ')
    expect(result.score).toBe(2)
    expect(result.results.lion.correct).toBe(true)
    expect(result.results.rhino.correct).toBe(false)
    expect(result.results.camel.correct).toBe(true)
  })

  it('awards 0/3 when no animal is named correctly', () => {
    const result = scoreNaming('แมว สุนัข')
    expect(result.score).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/scoring/naming.test.js`
Expected: FAIL — `naming.js` doesn't exist yet.

- [ ] **Step 3: Implement `naming.js`**

Create `src/main/scoring/naming.js`:
```js
import { normalizeText, keywordMatch } from './matchers.js'

const ACCEPTED_ANIMAL_TERMS = {
  lion: ['สิงโต', 'lion'],
  rhino: ['แรด', 'rhino', 'rhinoceros'],
  camel: ['อูฐ', 'camel']
}

export function scoreNaming(transcript) {
  const normalized = normalizeText(transcript)
  const results = {}
  let score = 0
  for (const [animal, terms] of Object.entries(ACCEPTED_ANIMAL_TERMS)) {
    const correct = keywordMatch(normalized, terms)
    results[animal] = { correct }
    if (correct) score += 1
  }
  return { score, maxScore: 3, results }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/scoring/naming.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/scoring/naming.js src/main/scoring/naming.test.js
git commit -m "feat: add naming subtest scorer"
```

---

### Task 5: Digit span scorer

**Files:**
- Create: `src/main/scoring/digitSpan.js`
- Test: `src/main/scoring/digitSpan.test.js`

**Interfaces:**
- Consumes: `extractDigitSequence` from `matchers.js` (Task 2).
- Produces: `scoreDigitSpan(transcript, expectedSequence: string): { score: number, maxScore: 1, spoken: string, expected: string }` — used by the scoring dispatcher (Task 6). Note: for the backward-recall item, `expectedSequence` is the *reversed* string the patient should say (e.g. patient hears "742", `expectedSequence` is `'247'`) — the reversal is baked into the subtest metadata (Task 6), not into this scorer.

- [ ] **Step 1: Write the failing tests**

Create `src/main/scoring/digitSpan.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { scoreDigitSpan } from './digitSpan.js'

describe('scoreDigitSpan', () => {
  it('awards 1/1 when the spoken sequence matches exactly', () => {
    const result = scoreDigitSpan('2 1 8 5 4', '21854')
    expect(result.score).toBe(1)
    expect(result.maxScore).toBe(1)
    expect(result.spoken).toBe('21854')
  })

  it('awards 0/1 when the sequence does not match', () => {
    const result = scoreDigitSpan('2 1 8 5 5', '21854')
    expect(result.score).toBe(0)
  })

  it('works for the reversed backward-recall sequence', () => {
    const result = scoreDigitSpan('2 4 7', '247')
    expect(result.score).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/scoring/digitSpan.test.js`
Expected: FAIL — `digitSpan.js` doesn't exist yet.

- [ ] **Step 3: Implement `digitSpan.js`**

Create `src/main/scoring/digitSpan.js`:
```js
import { extractDigitSequence } from './matchers.js'

export function scoreDigitSpan(transcript, expectedSequence) {
  const spoken = extractDigitSequence(transcript)
  const correct = spoken === expectedSequence
  return { score: correct ? 1 : 0, maxScore: 1, spoken, expected: expectedSequence }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/scoring/digitSpan.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/scoring/digitSpan.js src/main/scoring/digitSpan.test.js
git commit -m "feat: add digit span subtest scorer"
```

---

### Task 6: Subtest metadata + scoring dispatcher

**Files:**
- Create: `src/renderer/src/moca/subtests.js`
- Create: `src/main/scoring/index.js`
- Test: `src/main/scoring/index.test.js`

**Interfaces:**
- Consumes: `scoreOrientation` (Task 3), `scoreNaming` (Task 4), `scoreDigitSpan` (Task 5).
- Produces: `scoreItem(subtestId: string, transcript: string, context: object): object` — used by the IPC scoring handler (Task 8) and, indirectly, by `useSubtestSession` (Task 10). Also produces `SUBTESTS: Array<{ id, section, instructionTextEn, instructionTextTh, countdownSec, timeLimitSec, scorerId, expectedSequence? }>` — consumed by `useSubtestSession` (Task 10), `SessionRunner` (Task 12), and `SessionResults` (Task 11).

- [ ] **Step 1: Write the failing tests for the dispatcher**

Create `src/main/scoring/index.test.js`:
```js
import { describe, it, expect } from 'vitest'
import { scoreItem } from './index.js'

describe('scoreItem', () => {
  it('dispatches to the naming scorer', () => {
    const result = scoreItem('naming', 'สิงโต แรด อูฐ', {})
    expect(result.score).toBe(3)
  })

  it('dispatches to the digit span scorer using expectedSequence from context', () => {
    const result = scoreItem('digit-span-forward', '2 1 8 5 4', { expectedSequence: '21854' })
    expect(result.score).toBe(1)
  })

  it('dispatches to the orientation scorer using context', () => {
    const context = {
      referenceDate: new Date(2026, 7, 13),
      place: 'โรงพยาบาลศิริราช',
      province: 'กรุงเทพ'
    }
    const result = scoreItem('orientation', 'วันพฤหัสบดี', context)
    expect(result.maxScore).toBe(6)
  })

  it('throws for an unknown subtest id', () => {
    expect(() => scoreItem('unknown-subtest', 'text', {})).toThrow(
      'No scorer registered for subtest "unknown-subtest"'
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/scoring/index.test.js`
Expected: FAIL — `index.js` doesn't exist yet.

- [ ] **Step 3: Implement the dispatcher**

Create `src/main/scoring/index.js`:
```js
import { scoreOrientation } from './orientation.js'
import { scoreNaming } from './naming.js'
import { scoreDigitSpan } from './digitSpan.js'

export function scoreItem(subtestId, transcript, context) {
  switch (subtestId) {
    case 'orientation':
      return scoreOrientation(transcript, context)
    case 'naming':
      return scoreNaming(transcript)
    case 'digit-span-forward':
    case 'digit-span-backward':
      return scoreDigitSpan(transcript, context.expectedSequence)
    default:
      throw new Error(`No scorer registered for subtest "${subtestId}"`)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/scoring/index.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Create the subtest metadata (no test — static data)**

Create `src/renderer/src/moca/subtests.js`:
```js
export const SUBTESTS = [
  {
    id: 'naming',
    section: 'Naming',
    instructionTextEn:
      'You will see three animals. After the countdown, say the name of all three animals without stopping.',
    instructionTextTh: 'คุณจะเห็นสัตว์สามชนิด หลังนับถอยหลัง ให้บอกชื่อสัตว์ทั้งสามโดยไม่หยุด',
    countdownSec: 3,
    timeLimitSec: 15,
    scorerId: 'naming'
  },
  {
    id: 'digit-span-forward',
    section: 'Attention',
    instructionTextEn: 'Listen to the numbers, then repeat them in the same order.',
    instructionTextTh: 'ฟังตัวเลขต่อไปนี้ แล้วพูดทวนตามลำดับ',
    countdownSec: 0,
    timeLimitSec: 7,
    scorerId: 'digit-span-forward',
    expectedSequence: '21854'
  },
  {
    id: 'digit-span-backward',
    section: 'Attention',
    instructionTextEn: 'Listen to the numbers, then repeat them in reverse order.',
    instructionTextTh: 'ฟังตัวเลขต่อไปนี้ แล้วพูดทวนย้อนกลับ',
    countdownSec: 0,
    timeLimitSec: 7,
    scorerId: 'digit-span-backward',
    // Patient hears "742" and must say it reversed: "247".
    expectedSequence: '247'
  },
  {
    id: 'orientation',
    section: 'Orientation',
    instructionTextEn: "Tell me today's day, month, year, date, place, and province.",
    instructionTextTh: 'บอกวัน เดือน ปี วันที่ สถานที่ และจังหวัดในวันนี้',
    countdownSec: 0,
    timeLimitSec: 15,
    scorerId: 'orientation'
  }
]
```

- [ ] **Step 6: Commit**

```bash
git add src/main/scoring/index.js src/main/scoring/index.test.js src/renderer/src/moca/subtests.js
git commit -m "feat: add scoring dispatcher and subtest metadata"
```

---

### Task 7: Whisper ASR client

**Files:**
- Create: `src/main/asr/whisperClient.js`
- Test: `src/main/asr/whisperClient.test.js`
- Create: `.env.example`

**Interfaces:**
- Produces: `createWhisperClient({ apiKey?, fetchImpl? }): { transcribe(audioBuffer: ArrayBuffer, mimeType: string, language: string): Promise<string> }` — used by the IPC ASR handler (Task 8).

- [ ] **Step 1: Write the failing tests**

Create `src/main/asr/whisperClient.test.js`:
```js
import { describe, it, expect, vi } from 'vitest'
import { createWhisperClient } from './whisperClient.js'

describe('createWhisperClient', () => {
  it('throws if no API key is provided', () => {
    expect(() => createWhisperClient({ apiKey: undefined })).toThrow(
      'OPENAI_API_KEY is not set'
    )
  })

  it('sends the audio to the Whisper API and returns the transcript text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'สิงโต แรด อูฐ' })
    })
    const client = createWhisperClient({ apiKey: 'test-key', fetchImpl })

    const result = await client.transcribe(new ArrayBuffer(8), 'audio/webm', 'th')

    expect(result).toBe('สิงโต แรด อูฐ')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/transcriptions',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('throws a descriptive error when the API responds with a non-ok status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Invalid API key'
    })
    const client = createWhisperClient({ apiKey: 'bad-key', fetchImpl })

    await expect(
      client.transcribe(new ArrayBuffer(8), 'audio/webm', 'th')
    ).rejects.toThrow('Whisper API error (401): Invalid API key')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/asr/whisperClient.test.js`
Expected: FAIL — `whisperClient.js` doesn't exist yet.

- [ ] **Step 3: Implement `whisperClient.js`**

Create `src/main/asr/whisperClient.js`:
```js
export function createWhisperClient({ apiKey = process.env.OPENAI_API_KEY, fetchImpl = fetch } = {}) {
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set')
  }

  async function transcribe(audioBuffer, mimeType, language) {
    const extension = mimeType.includes('webm') ? 'webm' : 'wav'
    const form = new FormData()
    form.append('file', new Blob([audioBuffer], { type: mimeType }), `audio.${extension}`)
    form.append('model', 'whisper-1')
    form.append('language', language)

    const response = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Whisper API error (${response.status}): ${errorText}`)
    }

    const data = await response.json()
    return data.text
  }

  return { transcribe }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/asr/whisperClient.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Create `.env.example` documenting the required key**

Create `.env.example`:
```
OPENAI_API_KEY=sk-...
```

- [ ] **Step 6: Commit**

```bash
git add src/main/asr/whisperClient.js src/main/asr/whisperClient.test.js .env.example
git commit -m "feat: add Whisper ASR client"
```

---

### Task 8: IPC wiring (main + preload)

**Files:**
- Create: `src/main/ipc/asr.js`
- Create: `src/main/ipc/scoring.js`
- Modify: `src/main/index.js`
- Modify: `src/preload/index.js`

**Interfaces:**
- Consumes: `createWhisperClient` (Task 7), `scoreItem` (Task 6).
- Produces: renderer-visible `window.api.transcribeAudio(audioBuffer, mimeType, language): Promise<string>` and `window.api.scoreItem(subtestId, transcript, context): Promise<object>` — used by `useSubtestSession` (Task 10) via `SessionRunner` (Task 12).

No automated test for this task — it wires already-tested pure logic (Tasks 6, 7) to Electron's IPC transport, which requires a running Electron process to exercise. Verified manually at the end of Task 12.

- [ ] **Step 1: Create the ASR IPC handler**

Create `src/main/ipc/asr.js`:
```js
import { ipcMain } from 'electron'
import { createWhisperClient } from '../asr/whisperClient.js'

export function registerAsrHandlers() {
  const whisperClient = createWhisperClient()

  ipcMain.handle('asr:transcribe', async (_event, { audioBuffer, mimeType, language }) => {
    return whisperClient.transcribe(audioBuffer, mimeType, language)
  })
}
```

- [ ] **Step 2: Create the scoring IPC handler**

Create `src/main/ipc/scoring.js`:
```js
import { ipcMain } from 'electron'
import { scoreItem } from '../scoring/index.js'

export function registerScoringHandlers() {
  ipcMain.handle('scoring:score-item', async (_event, { subtestId, transcript, context }) => {
    return scoreItem(subtestId, transcript, context)
  })
}
```

- [ ] **Step 3: Register both handlers in the main process**

Modify `src/main/index.js` — add two imports after the existing `icon` import:
```js
import { registerAsrHandlers } from './ipc/asr.js'
import { registerScoringHandlers } from './ipc/scoring.js'
```

Then, inside `app.whenReady().then(() => { ... })`, replace this line:
```js
  // IPC test
  ipcMain.on('ping', () => console.log('pong'))
```
with:
```js
  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  registerAsrHandlers()
  registerScoringHandlers()
```

- [ ] **Step 4: Expose the two IPC calls to the renderer via preload**

Modify `src/preload/index.js` — change the import line:
```js
import { contextBridge } from 'electron'
```
to:
```js
import { contextBridge, ipcRenderer } from 'electron'
```

Then replace:
```js
// Custom APIs for renderer
const api = {}
```
with:
```js
// Custom APIs for renderer
const api = {
  transcribeAudio: (audioBuffer, mimeType, language) =>
    ipcRenderer.invoke('asr:transcribe', { audioBuffer, mimeType, language }),
  scoreItem: (subtestId, transcript, context) =>
    ipcRenderer.invoke('scoring:score-item', { subtestId, transcript, context })
}
```

- [ ] **Step 5: Verify the app still builds**

Run: `npm run build`
Expected: build succeeds with no errors (same as the existing baseline — this task doesn't change renderer code).

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/asr.js src/main/ipc/scoring.js src/main/index.js src/preload/index.js
git commit -m "feat: wire ASR and scoring IPC handlers"
```

---

### Task 9: Audio recorder (renderer)

**Files:**
- Create: `src/renderer/src/moca/AudioRecorder.js`
- Test: `src/renderer/src/moca/AudioRecorder.test.js`

**Interfaces:**
- Produces: `createAudioRecorder({ mediaRecorderClass?, getUserMedia? }): { start(): Promise<void>, stop(): Promise<Blob> }` — used by `useSubtestSession` (Task 10) via `SessionRunner` (Task 12). `mediaRecorderClass` and `getUserMedia` are injectable so real browser mic access is never required in tests.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/moca/AudioRecorder.test.js`:
```js
import { describe, it, expect, vi } from 'vitest'
import { createAudioRecorder } from './AudioRecorder.js'

class FakeMediaRecorder {
  constructor(stream) {
    this.stream = stream
    this.mimeType = 'audio/webm'
  }
  start() {
    this.started = true
  }
  stop() {
    if (this.ondataavailable) {
      this.ondataavailable({ data: new Blob(['fake-audio-bytes']) })
    }
    if (this.onstop) this.onstop()
  }
}

describe('createAudioRecorder', () => {
  it('requests the microphone on start and resolves a Blob on stop', async () => {
    const fakeTrack = { stop: vi.fn() }
    const fakeStream = { getTracks: () => [fakeTrack] }
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream)

    const recorder = createAudioRecorder({ mediaRecorderClass: FakeMediaRecorder, getUserMedia })

    await recorder.start()
    const blob = await recorder.stop()

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(blob).toBeInstanceOf(Blob)
    expect(fakeTrack.stop).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/moca/AudioRecorder.test.js`
Expected: FAIL — `AudioRecorder.js` doesn't exist yet.

- [ ] **Step 3: Implement `AudioRecorder.js`**

Create `src/renderer/src/moca/AudioRecorder.js`:
```js
export function createAudioRecorder({ mediaRecorderClass = MediaRecorder, getUserMedia } = {}) {
  const requestMic = getUserMedia ?? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  let recorder = null
  let chunks = []
  let stream = null

  async function start() {
    stream = await requestMic({ audio: true })
    chunks = []
    recorder = new mediaRecorderClass(stream)
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.start()
  }

  function stop() {
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType })
        stream.getTracks().forEach((track) => track.stop())
        resolve(blob)
      }
      recorder.stop()
    })
  }

  return { start, stop }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/moca/AudioRecorder.test.js`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/moca/AudioRecorder.js src/renderer/src/moca/AudioRecorder.test.js
git commit -m "feat: add AudioRecorder wrapper around MediaRecorder"
```

---

### Task 10: Subtest session state machine

**Files:**
- Create: `src/renderer/src/moca/useSubtestSession.js`
- Test: `src/renderer/src/moca/useSubtestSession.test.js`

**Interfaces:**
- Consumes: an array of subtest metadata shaped like `SUBTESTS` (Task 6); `transcribeAudio`, `scoreItem`, `createRecorder` functions shaped like the ones produced by Tasks 7–9 (passed in as dependencies, not imported directly, so this hook stays unit-testable with fakes).
- Produces: `useSubtestSession(subtests, deps, sessionContext?): { currentSubtest, phase: 'instruction'|'recording'|'scoring'|'done', results: Array<{subtestId, transcript, score, maxScore, ...}>, beginRecording(): Promise<void>, finishRecording(): Promise<void> }` — used by `SessionRunner` (Task 12) and `SessionResults` (Task 11, via the `results` shape). `sessionContext` (e.g. `{ place, province }`) is merged into every scoring call alongside a fresh `referenceDate: new Date()` and the subtest's own `expectedSequence` — this is what lets the Orientation scorer (Task 3), which needs `referenceDate`/`place`/`province`, receive them without every other scorer's context needing to know about them.

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/moca/useSubtestSession.test.js`:
```js
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSubtestSession } from './useSubtestSession.js'

const subtests = [
  { id: 'naming', scorerId: 'naming' },
  { id: 'orientation', scorerId: 'orientation' }
]

function setup() {
  const fakeRecorder = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(new Blob(['x']))
  }
  const createRecorder = vi.fn(() => fakeRecorder)
  const transcribeAudio = vi.fn().mockResolvedValue('สิงโต แรด อูฐ')
  const scoreItem = vi.fn().mockResolvedValue({ score: 3, maxScore: 3 })
  return { fakeRecorder, createRecorder, transcribeAudio, scoreItem }
}

describe('useSubtestSession', () => {
  it('starts on the first subtest in the instruction phase', () => {
    const deps = setup()
    const { result } = renderHook(() => useSubtestSession(subtests, deps))
    expect(result.current.currentSubtest.id).toBe('naming')
    expect(result.current.phase).toBe('instruction')
  })

  it('advances to the next subtest after recording and scoring finish', async () => {
    const deps = setup()
    const { result } = renderHook(() => useSubtestSession(subtests, deps))

    await act(async () => {
      await result.current.beginRecording()
    })
    expect(result.current.phase).toBe('recording')

    await act(async () => {
      await result.current.finishRecording()
    })

    expect(result.current.currentSubtest.id).toBe('orientation')
    expect(result.current.phase).toBe('instruction')
    expect(result.current.results).toHaveLength(1)
    expect(result.current.results[0]).toMatchObject({ subtestId: 'naming', score: 3, maxScore: 3 })
  })

  it('sets phase to done after the last subtest is scored', async () => {
    const deps = setup()
    const { result } = renderHook(() => useSubtestSession([subtests[1]], deps))

    await act(async () => {
      await result.current.beginRecording()
      await result.current.finishRecording()
    })

    expect(result.current.phase).toBe('done')
    expect(result.current.results).toHaveLength(1)
  })

  it('merges sessionContext (e.g. place/province) and a fresh referenceDate into the scoring context', async () => {
    const deps = setup()
    const sessionContext = { place: 'โรงพยาบาลตัวอย่าง', province: 'กรุงเทพ' }
    const { result } = renderHook(() => useSubtestSession([subtests[1]], deps, sessionContext))

    await act(async () => {
      await result.current.beginRecording()
      await result.current.finishRecording()
    })

    expect(deps.scoreItem).toHaveBeenCalledWith(
      'orientation',
      'สิงโต แรด อูฐ',
      expect.objectContaining({
        place: 'โรงพยาบาลตัวอย่าง',
        province: 'กรุงเทพ',
        referenceDate: expect.any(Date)
      })
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/moca/useSubtestSession.test.js`
Expected: FAIL — `useSubtestSession.js` doesn't exist yet.

- [ ] **Step 3: Implement `useSubtestSession.js`**

Create `src/renderer/src/moca/useSubtestSession.js`:
```js
import { useState, useCallback, useRef } from 'react'

export function useSubtestSession(
  subtests,
  { transcribeAudio, scoreItem, createRecorder },
  sessionContext = {}
) {
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState('instruction')
  const [results, setResults] = useState([])
  const recorderRef = useRef(null)

  const currentSubtest = subtests[index]

  const beginRecording = useCallback(async () => {
    recorderRef.current = createRecorder()
    await recorderRef.current.start()
    setPhase('recording')
  }, [createRecorder])

  const finishRecording = useCallback(async () => {
    setPhase('scoring')
    const blob = await recorderRef.current.stop()
    const audioBuffer = await blob.arrayBuffer()
    const transcript = await transcribeAudio(audioBuffer, blob.type, 'th')
    const scoreResult = await scoreItem(currentSubtest.scorerId, transcript, {
      expectedSequence: currentSubtest.expectedSequence,
      referenceDate: new Date(),
      ...sessionContext
    })

    setResults((prev) => [...prev, { subtestId: currentSubtest.id, transcript, ...scoreResult }])

    if (index + 1 < subtests.length) {
      setIndex((prev) => prev + 1)
      setPhase('instruction')
    } else {
      setPhase('done')
    }
  }, [currentSubtest, index, subtests.length, transcribeAudio, scoreItem, sessionContext])

  return { currentSubtest, phase, results, beginRecording, finishRecording }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/moca/useSubtestSession.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/moca/useSubtestSession.js src/renderer/src/moca/useSubtestSession.test.js
git commit -m "feat: add subtest session state machine"
```

---

### Task 11: Session results display

**Files:**
- Create: `src/renderer/src/pages/SessionResults.jsx`
- Test: `src/renderer/src/pages/SessionResults.test.jsx`

**Interfaces:**
- Consumes: `results` array shaped like `useSubtestSession`'s output (Task 10); `subtests` array shaped like `SUBTESTS` (Task 6).
- Produces: `<SessionResults results={...} subtests={...} />` — used by `SessionRunner` (Task 12).

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/pages/SessionResults.test.jsx`:
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
      { subtestId: 'naming', score: 2, maxScore: 3 },
      { subtestId: 'orientation', score: 6, maxScore: 6 }
    ]
    render(<SessionResults results={results} subtests={subtests} />)

    expect(screen.getByText('Naming')).toBeInTheDocument()
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    expect(screen.getByText('Orientation')).toBeInTheDocument()
    expect(screen.getByText('6 / 6')).toBeInTheDocument()
    expect(screen.getByText('Total: 8 / 9')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/pages/SessionResults.test.jsx`
Expected: FAIL — `SessionResults.jsx` doesn't exist yet.

- [ ] **Step 3: Implement `SessionResults.jsx`**

Create `src/renderer/src/pages/SessionResults.jsx`:
```jsx
export function SessionResults({ results, subtests }) {
  const total = results.reduce((sum, r) => sum + r.score, 0)
  const maxTotal = results.reduce((sum, r) => sum + r.maxScore, 0)

  return (
    <div className="session-results">
      <h2>MoCA Session Results</h2>
      <table>
        <thead>
          <tr>
            <th>Subtest</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const subtest = subtests.find((s) => s.id === r.subtestId)
            return (
              <tr key={r.subtestId}>
                <td>{subtest ? subtest.section : r.subtestId}</td>
                <td>
                  {r.score} / {r.maxScore}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="total">
        Total: {total} / {maxTotal}
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/pages/SessionResults.test.jsx`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pages/SessionResults.jsx src/renderer/src/pages/SessionResults.test.jsx
git commit -m "feat: add session results display"
```

---

### Task 12: Wire it all together in the app

**Files:**
- Create: `src/renderer/src/moca/SessionRunner.jsx`
- Modify: `src/renderer/src/App.jsx`

**Interfaces:**
- Consumes: `useSubtestSession` (Task 10), `createAudioRecorder` (Task 9), `SUBTESTS` (Task 6), `SessionResults` (Task 11), `window.api.transcribeAudio`/`window.api.scoreItem` (Task 8).
- Produces: the running app — no further tasks in this plan consume this.

This task has no automated test — it's the integration point that requires a real microphone and a real Electron window, which is verified manually below rather than mocked (mocking every dependency here would just re-test Task 10, already covered).

- [ ] **Step 1: Create `SessionRunner.jsx`**

Create `src/renderer/src/moca/SessionRunner.jsx`:
```jsx
import { useSubtestSession } from './useSubtestSession.js'
import { createAudioRecorder } from './AudioRecorder.js'
import { SUBTESTS } from './subtests.js'
import { SessionResults } from '../pages/SessionResults.jsx'

// TODO(follow-on plan): replace with a real settings screen. Hardcoded here
// because this plan doesn't build session configuration — see "What's
// Deliberately Out of Scope Here" at the bottom of this plan.
const SESSION_CONTEXT = { place: 'โรงพยาบาลตัวอย่าง', province: 'กรุงเทพ' }

export function SessionRunner() {
  const { currentSubtest, phase, results, beginRecording, finishRecording } = useSubtestSession(
    SUBTESTS,
    {
      transcribeAudio: (buffer, mimeType, language) =>
        window.api.transcribeAudio(buffer, mimeType, language),
      scoreItem: (subtestId, transcript, context) =>
        window.api.scoreItem(subtestId, transcript, context),
      createRecorder: createAudioRecorder
    },
    SESSION_CONTEXT
  )

  if (phase === 'done') {
    return <SessionResults results={results} subtests={SUBTESTS} />
  }

  return (
    <div className="session-runner">
      <h2>{currentSubtest.section}</h2>
      <p>{currentSubtest.instructionTextEn}</p>
      <p lang="th">{currentSubtest.instructionTextTh}</p>
      {phase === 'instruction' && <button onClick={beginRecording}>Start</button>}
      {phase === 'recording' && <button onClick={finishRecording}>Stop &amp; Score</button>}
      {phase === 'scoring' && <p>Scoring...</p>}
    </div>
  )
}
```

- [ ] **Step 2: Replace the boilerplate in `App.jsx`**

Replace the full contents of `src/renderer/src/App.jsx` with:
```jsx
import { SessionRunner } from './moca/SessionRunner.jsx'

function App() {
  return <SessionRunner />
}

export default App
```

- [ ] **Step 3: Add a real API key for manual verification**

Create `.env` (already gitignored by Task 1) with a real key:
```
OPENAI_API_KEY=sk-your-real-key-here
```

- [ ] **Step 4: Run the full automated test suite**

Run: `npm test`
Expected: all tests from Tasks 1–11 PASS (this task adds no new automated tests).

- [ ] **Step 5: Manual verification — run the app and go through all 4 subtests**

Run: `npm run dev`

In the Electron window that opens:
1. Confirm the Naming instructions appear in both English and Thai.
2. Click Start, grant microphone permission if prompted, say "สิงโต แรด อูฐ" (or "lion rhino camel"), click Stop & Score.
3. Confirm it advances to Digit Span Forward; say "2 1 8 5 4", click Stop & Score.
4. Confirm it advances to Digit Span Backward; say "2 4 7", click Stop & Score.
5. Confirm it advances to Orientation; state today's day, month, year (Buddhist Era — today's Gregorian year + 543), date, "โรงพยาบาลตัวอย่าง" for place, and "กรุงเทพ" for province (matching the hardcoded `SESSION_CONTEXT` in `SessionRunner.jsx`), click Stop & Score. Confirm it scores 6/6.
6. Confirm the final results table shows a score row for each of the 4 subtests and a correct total.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/moca/SessionRunner.jsx src/renderer/src/App.jsx
git commit -m "feat: wire subtest session into the app UI"
```

---

## What's Deliberately Out of Scope Here

Per the design doc's subsystem decomposition, these are separate follow-on plans, not part of this one:
- Remaining voice subtests (vigilance tap, serial-7, sentence repetition, fluency, abstraction, delayed recall, memory registration) — same pattern as Tasks 3–5, extended.
- Pen/hardware capture (Trail Making, Cube copy, Clock Drawing Test) — needs the Wacom SDK, not started here.
- Biomarker/deviation-scoring layer — needs pilot session data collected from multiple completed runs of this pipeline first.
- A settings/configuration screen for `place`/`province` used by Orientation — `SessionRunner` hardcodes them in `SESSION_CONTEXT` (Task 12) instead.
- Automatic countdown/time-limit enforcement — `SUBTESTS` metadata (Task 6) already carries `countdownSec`/`timeLimitSec` per the design doc's timing table, but nothing in this plan reads them yet; `SessionRunner` uses manual Start/Stop buttons instead. A follow-on plan should wire these into an actual on-screen timer that auto-advances on timeout.
