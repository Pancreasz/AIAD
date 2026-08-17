import { describe, it, expect } from 'vitest'
import { scoreAbstraction } from './abstraction.js'

describe('scoreAbstraction for รถไฟ–จักรยาน', () => {
  const score = (transcript) => scoreAbstraction(transcript, 'abstraction-1')

  it('accepts the category itself', () => {
    expect(score('ยานพาหนะ')).toMatchObject({ score: 1, maxScore: 1 })
  })

  it('accepts the shortened form a patient is likelier to say', () => {
    expect(score('เป็นพาหนะ')).toMatchObject({ score: 1 })
  })

  it('accepts a travel answer, which the instrument allows', () => {
    expect(score('ใช้เดินทาง')).toMatchObject({ score: 1 })
  })

  // MoCA scores the abstract category, not a shared physical feature.
  it('rejects the concrete answer about wheels', () => {
    expect(score('มีล้อเหมือนกัน')).toMatchObject({ score: 0, maxScore: 1 })
  })

  // The reason this scorer has no reject-list: a correct abstract answer is
  // allowed to mention a concrete detail too, and stripping the point for it
  // would take away something the patient earned.
  it('accepts an abstract answer that also mentions a concrete detail', () => {
    expect(score('เป็นพาหนะที่มีล้อ')).toMatchObject({ score: 1 })
  })

  it('scores nothing when the patient only repeats the two items back', () => {
    expect(score('รถไฟกับจักรยาน')).toMatchObject({ score: 0 })
  })

  it('scores nothing for no answer', () => {
    expect(score('')).toMatchObject({ score: 0 })
  })
})

describe('scoreAbstraction for นาฬิกา–ไม้บรรทัด', () => {
  const score = (transcript) => scoreAbstraction(transcript, 'abstraction-2')

  it('accepts the category itself', () => {
    expect(score('เครื่องมือวัด')).toMatchObject({ score: 1, maxScore: 1 })
  })

  it('accepts a bare verb answer', () => {
    expect(score('ใช้วัด')).toMatchObject({ score: 1 })
  })

  it('rejects the concrete answer about numbers', () => {
    expect(score('มีตัวเลขเหมือนกัน')).toMatchObject({ score: 0 })
  })

  // ไม้บรรทัด ends in ทัด, not วัด. If it did contain the accepted keyword,
  // a patient parroting the question would score a point for saying nothing.
  it('scores nothing when the patient only repeats the two items back', () => {
    expect(score('นาฬิกากับไม้บรรทัด')).toMatchObject({ score: 0 })
  })
})

describe('scoreAbstraction across both items', () => {
  // Thai does not space between words and Whisper's spacing is arbitrary, so
  // the same utterance can arrive either way. Substring matching handles both;
  // token splitting would score the run-on form as wrong.
  it('matches a run-on transcript with no spaces', () => {
    expect(scoreAbstraction('ทั้งสองอย่างเป็นยานพาหนะครับ', 'abstraction-1')).toMatchObject({
      score: 1
    })
  })

  it('reports which accepted term matched, for checking against real speech', () => {
    expect(scoreAbstraction('ยานพาหนะ', 'abstraction-1').matched).toBe('ยานพาหนะ')
  })

  it('reports no match when nothing was accepted', () => {
    expect(scoreAbstraction('มีล้อ', 'abstraction-1').matched).toBeNull()
  })

  // A typo in a subtest id must not silently score every patient zero.
  it('throws on an unknown item rather than scoring it wrong', () => {
    expect(() => scoreAbstraction('ยานพาหนะ', 'abstraction-9')).toThrow('abstraction-9')
  })

  it('does not let one item’s answer score the other', () => {
    expect(scoreAbstraction('เครื่องมือวัด', 'abstraction-1')).toMatchObject({ score: 0 })
    expect(scoreAbstraction('ยานพาหนะ', 'abstraction-2')).toMatchObject({ score: 0 })
  })
})
