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
