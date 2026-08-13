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
