import { describe, it, expect } from 'vitest'
import { scoreVerbalFluency } from './verbalFluency.js'

const ELEVEN_WORDS =
  'กา กบ กล้วย กระต่าย กางเกง การ์ตูน กระเป๋า กระดาษ กรรไกร กุ้ง กล่อง'
const TEN_WORDS = 'กา กบ กล้วย กระต่าย กางเกง การ์ตูน กระเป๋า กระดาษ กรรไกร กุ้ง'

describe('scoreVerbalFluency', () => {
  it('scores the point at exactly the 11-word cutoff', () => {
    expect(scoreVerbalFluency(ELEVEN_WORDS)).toMatchObject({
      score: 1,
      maxScore: 1,
      wordCount: 11
    })
  })

  it('scores nothing one word short of the cutoff', () => {
    expect(scoreVerbalFluency(TEN_WORDS)).toMatchObject({ score: 0, wordCount: 10 })
  })

  it('does not count a word twice when the patient repeats it', () => {
    expect(scoreVerbalFluency(`${ELEVEN_WORDS} กา`)).toMatchObject({ wordCount: 11 })
  })

  it('ignores words that do not start with the target letter', () => {
    expect(scoreVerbalFluency(`${TEN_WORDS} บ้าน ปลา`)).toMatchObject({ wordCount: 10 })
  })

  it('splits on commas as well as spaces', () => {
    expect(scoreVerbalFluency(ELEVEN_WORDS.replaceAll(' ', ', '))).toMatchObject({
      wordCount: 11
    })
  })

  it('scores nothing for no answer', () => {
    expect(scoreVerbalFluency('')).toMatchObject({ score: 0, maxScore: 1, wordCount: 0 })
  })

  it('reports the qualifying words for checking against real speech', () => {
    expect(scoreVerbalFluency('กา บ้าน กบ').words).toEqual(['กา', 'กบ'])
  })
})
