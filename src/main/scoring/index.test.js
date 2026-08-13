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
