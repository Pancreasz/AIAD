import { describe, it, expect } from 'vitest'
import { SUBTESTS } from './subtests.js'
import { scoreItem } from '../../../main/scoring/index.js'

describe('SUBTESTS', () => {
  it('includes Serial 7s in the Attention section', () => {
    const serialSevens = SUBTESTS.find((s) => s.id === 'serial-sevens')
    expect(serialSevens).toBeDefined()
    expect(serialSevens.section).toBe('Attention')
  })

  it('runs Serial 7s after both digit span trials', () => {
    const ids = SUBTESTS.map((s) => s.id)
    expect(ids.indexOf('serial-sevens')).toBeGreaterThan(ids.indexOf('digit-span-backward'))
  })

  it('gives Serial 7s no stimulus audio, since the patient is told a number rather than played one', () => {
    const serialSevens = SUBTESTS.find((s) => s.id === 'serial-sevens')
    expect(serialSevens.audio).toBeUndefined()
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
      province: 'กรุงเทพ'
    }
    for (const subtest of SUBTESTS) {
      expect(() => scoreItem(subtest.scorerId, '', context)).not.toThrow()
    }
  })
})
