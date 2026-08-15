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
