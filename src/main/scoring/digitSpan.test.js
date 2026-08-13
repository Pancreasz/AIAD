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
