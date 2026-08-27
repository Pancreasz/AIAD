import { describe, it, expect } from 'vitest'
import { scoreSentenceRepetition } from './sentenceRepetition.js'

describe('scoreSentenceRepetition for sentence 1', () => {
  const score = (transcript) => scoreSentenceRepetition(transcript, 'sentence-repetition-1')

  it('scores the exact sentence', () => {
    expect(score('ฉันรู้ว่าจอมเป็นคนเดียวที่มาช่วยงานวันนี้')).toMatchObject({
      score: 1,
      maxScore: 1
    })
  })

  // Whisper's Thai spacing is arbitrary for a continuous sentence -- the exact
  // same words can come back spaced or run on. Either form is a correct
  // repetition and must score the same.
  it('scores the same sentence with spaces inserted between words', () => {
    expect(score('ฉัน รู้ว่า จอม เป็นคนเดียว ที่มา ช่วยงาน วันนี้')).toMatchObject({ score: 1 })
  })

  it('scores nothing for an omitted word', () => {
    expect(score('ฉันรู้ว่าจอมเป็นคนที่มาช่วยงานวันนี้')).toMatchObject({ score: 0 })
  })

  it('scores nothing for a substituted word', () => {
    expect(score('ฉันรู้ว่าจอมเป็นคนเดียวที่มาช่วยงานเมื่อวาน')).toMatchObject({ score: 0 })
  })

  it('scores nothing for no answer', () => {
    expect(score('')).toMatchObject({ score: 0 })
  })
})

describe('scoreSentenceRepetition for sentence 2', () => {
  const score = (transcript) => scoreSentenceRepetition(transcript, 'sentence-repetition-2')

  it('scores the exact sentence', () => {
    expect(score('แมวมักซ่อนตัวอยู่หลังเก้าอี้เมื่อมีหมาอยู่ในห้อง')).toMatchObject({
      score: 1,
      maxScore: 1
    })
  })

  it('does not let one item’s answer score the other', () => {
    expect(
      scoreSentenceRepetition('ฉันรู้ว่าจอมเป็นคนเดียวที่มาช่วยงานวันนี้', 'sentence-repetition-2')
    ).toMatchObject({ score: 0 })
  })
})

describe('scoreSentenceRepetition on an unknown item', () => {
  // A typo in a subtest id must not silently score every patient zero.
  it('throws rather than scoring it wrong', () => {
    expect(() => scoreSentenceRepetition('anything', 'sentence-repetition-9')).toThrow(
      'sentence-repetition-9'
    )
  })
})
