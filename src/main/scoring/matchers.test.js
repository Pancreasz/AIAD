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

describe('extractDigitSequence with run-on Thai', () => {
  // Thai does not put spaces between words, so whether Whisper returns
  // "สอง สี่ เจ็ด" or "สองสี่เจ็ด" for the same utterance is arbitrary.
  // Splitting on whitespace scored the second form as nothing at all.
  it('extracts digits from Thai number words with no spaces', () => {
    expect(extractDigitSequence('สองสี่เจ็ด')).toBe('247')
  })

  it('extracts a longer run-on sequence', () => {
    expect(extractDigitSequence('สองหนึ่งแปดห้าสี่')).toBe('21854')
  })

  it('handles a mix of spaced and run-on words', () => {
    expect(extractDigitSequence('สอง สี่เจ็ด')).toBe('247')
  })

  it('reads Thai numerals', () => {
    expect(extractDigitSequence('๒๔๗')).toBe('247')
    expect(extractDigitSequence('๒ ๑ ๘ ๕ ๔')).toBe('21854')
  })

  it('mixes Thai numerals, Arabic numerals and words', () => {
    expect(extractDigitSequence('๒ 4 เจ็ด')).toBe('247')
  })

  it('ignores a trailing politeness particle', () => {
    expect(extractDigitSequence('สองสี่เจ็ดครับ')).toBe('247')
  })

  it('covers every digit word run together', () => {
    expect(extractDigitSequence('ศูนย์หนึ่งสองสามสี่ห้าหกเจ็ดแปดเก้า')).toBe('0123456789')
  })

  it('still returns nothing for speech containing no digits', () => {
    expect(extractDigitSequence('ไม่ทราบ')).toBe('')
  })
})
