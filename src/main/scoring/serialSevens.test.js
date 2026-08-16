import { describe, it, expect } from 'vitest'
import { scoreSerialSevens } from './serialSevens.js'

describe('scoreSerialSevens', () => {
  it('awards 3/3 for all five subtractions correct', () => {
    const result = scoreSerialSevens('93 86 79 72 65')
    expect(result.score).toBe(3)
    expect(result.maxScore).toBe(3)
    expect(result.correctCount).toBe(5)
  })

  it('awards 3/3 for four correct subtractions', () => {
    // 93, 86, 79, 72 correct; the fifth answer is wrong.
    const result = scoreSerialSevens('93 86 79 72 64')
    expect(result.correctCount).toBe(4)
    expect(result.score).toBe(3)
  })

  it('awards 2/3 for three correct subtractions', () => {
    const result = scoreSerialSevens('93 86 79 60 50')
    expect(result.correctCount).toBe(3)
    expect(result.score).toBe(2)
  })

  it('awards 2/3 for two correct subtractions', () => {
    const result = scoreSerialSevens('93 86 60 50 40')
    expect(result.correctCount).toBe(2)
    expect(result.score).toBe(2)
  })

  it('awards 1/3 for one correct subtraction', () => {
    const result = scoreSerialSevens('93 80 70 60 50')
    expect(result.correctCount).toBe(1)
    expect(result.score).toBe(1)
  })

  it('awards 0/3 when no subtraction is correct', () => {
    const result = scoreSerialSevens('90 80 70 60 50')
    expect(result.correctCount).toBe(0)
    expect(result.score).toBe(0)
  })

  // The official MoCA rule: each subtraction is evaluated against the number
  // the patient actually said, not against the ideal sequence. One arithmetic
  // slip must not cascade into four lost points.
  it('scores each subtraction against the previous answer, not the ideal sequence', () => {
    // 93 correct, 85 wrong -- but 78, 71, 64 each subtract 7 correctly from
    // the answer before them, so four of the five subtractions are correct.
    const result = scoreSerialSevens('93 85 78 71 64')
    expect(result.correctCount).toBe(4)
    expect(result.score).toBe(3)
  })

  it('reads answers spoken as Thai number words', () => {
    const result = scoreSerialSevens('เก้าสิบสาม แปดสิบหก เจ็ดสิบเก้า เจ็ดสิบสอง หกสิบห้า')
    expect(result.correctCount).toBe(5)
    expect(result.score).toBe(3)
  })

  it('ignores a leading echo of the starting number', () => {
    const result = scoreSerialSevens('100 93 86 79 72 65')
    expect(result.correctCount).toBe(5)
    expect(result.score).toBe(3)
  })

  it('scores only the first five subtractions', () => {
    const result = scoreSerialSevens('93 86 79 72 65 58 51')
    expect(result.correctCount).toBe(5)
    expect(result.spoken).toEqual([93, 86, 79, 72, 65])
  })

  it('counts a short answer as incomplete rather than wrong', () => {
    const result = scoreSerialSevens('93 86')
    expect(result.correctCount).toBe(2)
    expect(result.score).toBe(2)
  })

  it('awards 0/3 when the patient says nothing scorable', () => {
    const result = scoreSerialSevens('ไม่ทราบ')
    expect(result.correctCount).toBe(0)
    expect(result.score).toBe(0)
    expect(result.spoken).toEqual([])
  })

  it('reports each subtraction so a reviewer can audit the scoring', () => {
    const result = scoreSerialSevens('93 85 78')
    expect(result.subtractions).toEqual([
      { answer: 93, expected: 93, correct: true },
      { answer: 85, expected: 86, correct: false },
      { answer: 78, expected: 78, correct: true }
    ])
  })
})
