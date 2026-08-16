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

  it('dispatches to the serial sevens scorer, which scores out of 3', () => {
    const result = scoreItem('serial-sevens', '93 86 79 72 65', {})
    expect(result.score).toBe(3)
    expect(result.maxScore).toBe(3)
  })

  it('dispatches to the vigilance scorer, reading taps from the context', () => {
    const result = scoreItem('vigilance', '', {
      taps: [1500],
      sequence: '51',
      target: '1',
      intervalMs: 1000
    })
    expect(result).toMatchObject({ score: 1, maxScore: 1, hits: 1 })
  })

  it('throws for an unknown subtest id', () => {
    expect(() => scoreItem('unknown-subtest', 'text', {})).toThrow(
      'No scorer registered for subtest "unknown-subtest"'
    )
  })
})
