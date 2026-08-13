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
