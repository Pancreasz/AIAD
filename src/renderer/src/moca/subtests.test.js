import { describe, it, expect } from 'vitest'
import { SUBTESTS } from './subtests.js'
import { scoreItem } from '../../../main/scoring/index.js'

describe('SUBTESTS', () => {
  it('includes Serial 7s in the Attention section', () => {
    const serialSevens = SUBTESTS.find((s) => s.id === 'serial-sevens')
    expect(serialSevens).toBeDefined()
    expect(serialSevens.section).toBe('Attention')
  })

  it('administers Attention in the instrument order: digit span, vigilance, serial 7s', () => {
    const ids = SUBTESTS.map((s) => s.id)
    expect(ids.indexOf('vigilance')).toBeGreaterThan(ids.indexOf('digit-span-backward'))
    expect(ids.indexOf('serial-sevens')).toBeGreaterThan(ids.indexOf('vigilance'))
  })

  it('gives Serial 7s no stimulus audio, since the patient is told a number rather than played one', () => {
    const serialSevens = SUBTESTS.find((s) => s.id === 'serial-sevens')
    expect(serialSevens.audio).toBeUndefined()
  })

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

  it('includes both Abstraction items, each worth its own point', () => {
    const ids = SUBTESTS.map((s) => s.id)
    expect(ids).toContain('abstraction-1')
    expect(ids).toContain('abstraction-2')
  })

  // SessionResults labels rows by section, so two rows both reading
  // "Abstraction" would be indistinguishable to anyone reading the output --
  // the same reason the two memory trials carry distinct sections.
  it('gives the two Abstraction items distinguishable section labels', () => {
    const sections = SUBTESTS.filter((s) => s.id.startsWith('abstraction')).map((s) => s.section)
    expect(new Set(sections).size).toBe(2)
  })

  it('asks Abstraction after Serial 7s and before Delayed Recall, as the instrument does', () => {
    const ids = SUBTESTS.map((s) => s.id)
    expect(ids.indexOf('abstraction-1')).toBeGreaterThan(ids.indexOf('serial-sevens'))
    expect(ids.indexOf('abstraction-2')).toBeGreaterThan(ids.indexOf('abstraction-1'))
    expect(ids.indexOf('delayed-recall')).toBeGreaterThan(ids.indexOf('abstraction-2'))
  })

  // The banana-orange example teaches the patient what kind of answer is
  // wanted. Without it people give concrete answers and score 0 for not
  // understanding the task rather than for failing it, so it must reach them
  // even in a session run with the sound off.
  it('carries the worked example in the first item’s instruction text', () => {
    const first = SUBTESTS.find((s) => s.id === 'abstraction-1')
    expect(first.instructionTextTh).toContain('กล้วย')
    expect(first.instructionTextTh).toContain('ส้ม')
  })

  it('gives each Abstraction item its own instruction recording and no stimulus', () => {
    for (const id of ['abstraction-1', 'abstraction-2']) {
      const subtest = SUBTESTS.find((s) => s.id === id)
      expect(subtest.instructionAudio).toBe(`moca/audio/instr-${id}.mp3`)
      expect(subtest.audio).toBeUndefined()
    }
  })

  it('includes both Sentence Repetition items, each with its own instruction and stimulus audio', () => {
    for (const id of ['sentence-repetition-1', 'sentence-repetition-2']) {
      const subtest = SUBTESTS.find((s) => s.id === id)
      expect(subtest).toBeDefined()
      expect(subtest.instructionAudio).toBe('moca/audio/instr-sentence-repeat.mp3')
      // .wav, not .mp3 -- the recordings that exist for these are WAV.
      expect(subtest.audio).toBe(`moca/audio/${id.replace('sentence-repetition', 'sentence')}.wav`)
    }
  })

  it('gives the two Sentence Repetition items distinguishable section labels', () => {
    const sections = SUBTESTS.filter((s) => s.id.startsWith('sentence-repetition')).map(
      (s) => s.section
    )
    expect(new Set(sections).size).toBe(2)
  })

  it('includes Verbal Fluency with a real, enforced 60-second cutoff', () => {
    const fluency = SUBTESTS.find((s) => s.id === 'verbal-fluency')
    expect(fluency).toBeDefined()
    expect(fluency.section).toBe('Verbal Fluency')
    expect(fluency.autoStopMs).toBe(60_000)
    expect(fluency.audio).toBeUndefined()
  })

  // Every other subtest's timeLimitSec is a process-data budget only -- see
  // the Not-yet-built handout constraint. Verbal Fluency is the sole
  // exception, so it must be the sole subtest carrying autoStopMs.
  it('leaves every subtest but Verbal Fluency without an enforced auto-stop', () => {
    const autoStopping = SUBTESTS.filter((s) => s.autoStopMs)
    expect(autoStopping.map((s) => s.id)).toEqual(['verbal-fluency'])
  })

  it('administers Sentence Repetition and Verbal Fluency after Serial 7s and before Abstraction', () => {
    const ids = SUBTESTS.map((s) => s.id)
    for (const id of ['sentence-repetition-1', 'sentence-repetition-2', 'verbal-fluency']) {
      expect(ids.indexOf(id)).toBeGreaterThan(ids.indexOf('serial-sevens'))
      expect(ids.indexOf(id)).toBeLessThan(ids.indexOf('abstraction-1'))
    }
  })

  // A scorerId that does not match any registered scorer is invisible until a
  // patient reaches that subtest mid-session and the run dies on it. This
  // catches the typo at build time instead.
  it('registers a scorer for every subtest', () => {
    // The same context shape useSubtestSession builds, so a scorer that needs
    // a field gets it rather than failing on a missing one.
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
    for (const subtest of SUBTESTS) {
      expect(() => scoreItem(subtest.scorerId, '', context)).not.toThrow()
    }
  })
})
