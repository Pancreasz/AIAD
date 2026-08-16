export function normalizeText(text) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function exactMatch(transcript, expected) {
  return normalizeText(transcript) === normalizeText(expected)
}

export function keywordMatch(transcript, acceptedKeywords) {
  const normalized = normalizeText(transcript)
  return acceptedKeywords.some((keyword) => normalized.includes(normalizeText(keyword)))
}

const THAI_DIGIT_WORDS = {
  ศูนย์: '0',
  หนึ่ง: '1',
  สอง: '2',
  สาม: '3',
  สี่: '4',
  ห้า: '5',
  หก: '6',
  เจ็ด: '7',
  แปด: '8',
  เก้า: '9'
}

// Longest first, so a shorter word can never shadow a longer one that starts
// with the same characters.
const THAI_DIGIT_ENTRIES = Object.entries(THAI_DIGIT_WORDS).sort(
  ([a], [b]) => b.length - a.length
)

// Thai numerals ๐-๙, in value order.
const THAI_NUMERALS = '๐๑๒๓๔๕๖๗๘๙'

// Scans the transcript character by character rather than splitting on
// whitespace. Thai does not space between words, so whether Whisper returns
// "สอง สี่ เจ็ด" or "สองสี่เจ็ด" for the same utterance is arbitrary -- and
// the whitespace-splitting version scored the run-on form as no digits at
// all, silently marking a correct answer wrong. Scanning handles spaced,
// run-on, and mixed forms identically, plus Thai and Arabic numerals.
export function extractDigitSequence(transcript) {
  const normalized = normalizeText(transcript)
  const digits = []

  let i = 0
  while (i < normalized.length) {
    const char = normalized[i]

    if (char >= '0' && char <= '9') {
      digits.push(char)
      i += 1
      continue
    }

    const numeral = THAI_NUMERALS.indexOf(char)
    if (numeral !== -1) {
      digits.push(String(numeral))
      i += 1
      continue
    }

    const word = THAI_DIGIT_ENTRIES.find(([thai]) => normalized.startsWith(thai, i))
    if (word) {
      digits.push(word[1])
      i += word[0].length
      continue
    }

    i += 1
  }

  return digits.join('')
}

export function numberSequenceMatch(transcript, expectedSequence) {
  return extractDigitSequence(transcript) === expectedSequence
}

// Thai cardinals are positional, not a digit string: เก้าสิบสาม is 93, built
// as 9 x 10 + 3. Two irregular forms matter in the 0-100 range Serial 7s
// lives in -- ยี่ replaces สอง before สิบ (ยี่สิบ = 20), and เอ็ด replaces
// หนึ่ง in the ones place of a compound (ห้าสิบเอ็ด = 51).
const THAI_UNIT_WORDS = { ...THAI_DIGIT_WORDS, เอ็ด: '1', 'ยี่': '2' }

const THAI_UNIT_ENTRIES = Object.entries(THAI_UNIT_WORDS)
  .map(([thai, digit]) => [thai, Number(digit)])
  .sort(([a], [b]) => b.length - a.length)

const THAI_MULTIPLIERS = { สิบ: 10, ร้อย: 100 }

const THAI_MULTIPLIER_ENTRIES = Object.entries(THAI_MULTIPLIERS).sort(
  ([a], [b]) => b.length - a.length
)

// Reads whole numbers rather than loose digits. Deliberately separate from
// extractDigitSequence: that one answers "which digits were spoken, in what
// order" for Digit Span, and drops สิบ on the floor, so it reads ห้าสิบเอ็ด
// (51) as "5" and ยี่สิบ (20) as nothing.
//
// Whitespace never ends a number, because Whisper's Thai spacing is
// arbitrary -- "เก้าสิบสาม" and "เก้า สิบ สาม" are the same utterance, and
// treating a space as a boundary would read the second as 9, 10, 3. What
// separates two numbers instead is grammar: a unit word arriving while a ones
// digit is already pending can only be the start of the next number.
//
// The cost of that choice is that "ห้า สิบ" (five, ten) reads as 50, and a
// run-on "หนึ่งร้อยเก้าสิบสาม" is genuinely 193 in Thai, so a patient who
// echoes the 100 before answering 93 without a pause is unrecoverable. Both
// are rarer than arbitrary spacing inside one number.
export function extractNumberSequence(transcript) {
  const normalized = normalizeText(transcript)
  const numbers = []

  let total = 0
  let pending = null
  let started = false

  const flush = () => {
    if (started || pending !== null) numbers.push(total + (pending ?? 0))
    total = 0
    pending = null
    started = false
  }

  let i = 0
  while (i < normalized.length) {
    const char = normalized[i]

    // A run of numerals is a complete number on its own: "93" is ninety-three,
    // not nine then three.
    if ((char >= '0' && char <= '9') || THAI_NUMERALS.includes(char)) {
      flush()
      let digits = ''
      while (i < normalized.length) {
        const next = normalized[i]
        if (next >= '0' && next <= '9') digits += next
        else if (THAI_NUMERALS.includes(next)) digits += String(THAI_NUMERALS.indexOf(next))
        else break
        i += 1
      }
      numbers.push(Number(digits))
      continue
    }

    const multiplier = THAI_MULTIPLIER_ENTRIES.find(([thai]) => normalized.startsWith(thai, i))
    if (multiplier) {
      // A bare สิบ or ร้อย means one of them: สิบห้า is 15, ร้อย is 100.
      total += (pending ?? 1) * multiplier[1]
      pending = null
      started = true
      i += multiplier[0].length
      continue
    }

    const unit = THAI_UNIT_ENTRIES.find(([thai]) => normalized.startsWith(thai, i))
    if (unit) {
      if (pending !== null) flush()
      pending = unit[1]
      i += unit[0].length
      continue
    }

    if (char !== ' ') flush()
    i += 1
  }

  flush()
  return numbers
}
