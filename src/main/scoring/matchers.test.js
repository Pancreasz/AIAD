import { describe, it, expect } from 'vitest'
import {
  normalizeText,
  exactMatch,
  keywordMatch,
  extractDigitSequence,
  numberSequenceMatch
} from './matchers.js'

describe('normalizeText', () => {
  it('trims, lowercases, and collapses whitespace', () => {
    expect(normalizeText('  Hello   World  ')).toBe('hello world')
  })
})

describe('exactMatch', () => {
  it('matches after normalization', () => {
    expect(exactMatch('  Hello World ', 'hello world')).toBe(true)
  })

  it('rejects different text', () => {
    expect(exactMatch('hello', 'goodbye')).toBe(false)
  })
})

describe('keywordMatch', () => {
  it('matches if any accepted keyword appears in the transcript', () => {
    expect(keywordMatch('I saw a สิงโต today', ['สิงโต', 'lion'])).toBe(true)
  })

  it('returns false if no accepted keyword appears', () => {
    expect(keywordMatch('I saw a cat', ['สิงโต', 'lion'])).toBe(false)
  })
})

describe('extractDigitSequence', () => {
  it('extracts numeric digits spoken as numerals', () => {
    expect(extractDigitSequence('2 1 8 5 4')).toBe('21854')
  })

  it('extracts digits spoken as Thai number words', () => {
    expect(extractDigitSequence('สอง หนึ่ง แปด ห้า สี่')).toBe('21854')
  })

  it('handles a mix of numerals and Thai words', () => {
    expect(extractDigitSequence('2 หนึ่ง 8 ห้า 4')).toBe('21854')
  })
})

describe('numberSequenceMatch', () => {
  it('matches when the extracted sequence equals the expected sequence', () => {
    expect(numberSequenceMatch('2 1 8 5 4', '21854')).toBe(true)
  })

  it('rejects when the sequence differs', () => {
    expect(numberSequenceMatch('2 1 8 5 5', '21854')).toBe(false)
  })
})
