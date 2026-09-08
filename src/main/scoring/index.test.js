import { describe, it, expect } from 'vitest'
import { scoreItem } from './index.js'

// scoreItem is async: the drawing scorers (clock/cube) await the sidecar over
// HTTP, so dispatch is a Promise even for the speech/tap scorers that resolve
// synchronously. Each case awaits the result; the unknown-id case rejects
// rather than throwing synchronously.
describe('scoreItem', () => {
  it('dispatches to the naming scorer', async () => {
    const result = await scoreItem('naming', 'สิงโต แรด อูฐ', {})
    expect(result.score).toBe(3)
  })

  it('dispatches to the digit span scorer using expectedSequence from context', async () => {
    const result = await scoreItem('digit-span-forward', '2 1 8 5 4', { expectedSequence: '21854' })
    expect(result.score).toBe(1)
  })

  it('dispatches to the orientation scorer using context', async () => {
    const context = {
      referenceDate: new Date(2026, 7, 13),
      place: 'โรงพยาบาลศิริราช',
      province: 'กรุงเทพ'
    }
    const result = await scoreItem('orientation', 'วันพฤหัสบดี', context)
    expect(result.maxScore).toBe(6)
  })

  it('dispatches to the memory registration scorer, which never scores points', async () => {
    const result = await scoreItem('memory-registration', 'หน้า ผ้าไหม วัด มะลิ สีแดง', {})
    expect(result.score).toBe(0)
    expect(result.maxScore).toBe(0)
    expect(result.recalledCount).toBe(5)
  })

  it('dispatches to the delayed recall scorer, which scores out of 5', async () => {
    const result = await scoreItem('delayed-recall', 'หน้า วัด สีแดง', {})
    expect(result.score).toBe(3)
    expect(result.maxScore).toBe(5)
  })

  it('dispatches to the serial sevens scorer, which scores out of 3', async () => {
    const result = await scoreItem('serial-sevens', '93 86 79 72 65', {})
    expect(result.score).toBe(3)
    expect(result.maxScore).toBe(3)
  })

  it('dispatches to the vigilance scorer, reading taps from the context', async () => {
    const result = await scoreItem('vigilance', '', {
      taps: [1500],
      sequence: '51',
      target: '1',
      intervalMs: 1000
    })
    expect(result).toMatchObject({ score: 1, maxScore: 1, hits: 1 })
  })

  // Both abstraction items share a scorer, so the dispatch has to carry which
  // pair was asked -- otherwise the watch/ruler answer would score the
  // train/bicycle item.
  it('dispatches each abstraction item against its own accepted terms', async () => {
    expect(await scoreItem('abstraction-1', 'ยานพาหนะ', {})).toMatchObject({ score: 1, maxScore: 1 })
    expect(await scoreItem('abstraction-2', 'เครื่องมือวัด', {})).toMatchObject({
      score: 1,
      maxScore: 1
    })
    expect(await scoreItem('abstraction-2', 'ยานพาหนะ', {})).toMatchObject({ score: 0 })
  })

  // Both sentence items share a scorer, so the dispatch has to carry which
  // sentence was asked.
  it('dispatches each sentence repetition item against its own expected sentence', async () => {
    expect(
      await scoreItem('sentence-repetition-1', 'ฉันรู้ว่าจอมเป็นคนเดียวที่มาช่วยงานวันนี้', {})
    ).toMatchObject({ score: 1, maxScore: 1 })
    expect(
      await scoreItem('sentence-repetition-2', 'แมวมักซ่อนตัวอยู่หลังเก้าอี้เมื่อมีหมาอยู่ในห้อง', {})
    ).toMatchObject({ score: 1, maxScore: 1 })
    expect(
      await scoreItem('sentence-repetition-2', 'ฉันรู้ว่าจอมเป็นคนเดียวที่มาช่วยงานวันนี้', {})
    ).toMatchObject({ score: 0 })
  })

  it('dispatches to the verbal fluency scorer', async () => {
    const result = await scoreItem('verbal-fluency', 'กา กบ', {})
    expect(result).toMatchObject({ maxScore: 1, wordCount: 2 })
  })

  it('rejects for an unknown subtest id', async () => {
    await expect(scoreItem('unknown-subtest', 'text', {})).rejects.toThrow(
      'No scorer registered for subtest "unknown-subtest"'
    )
  })
})
