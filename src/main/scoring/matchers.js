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
