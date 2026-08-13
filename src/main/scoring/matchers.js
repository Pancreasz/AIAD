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

export function extractDigitSequence(transcript) {
  const normalized = normalizeText(transcript)
  const words = normalized.split(' ')
  const digits = []
  for (const word of words) {
    if (/^\d$/.test(word)) {
      digits.push(word)
    } else if (THAI_DIGIT_WORDS[word]) {
      digits.push(THAI_DIGIT_WORDS[word])
    } else {
      const embedded = word.match(/\d/g)
      if (embedded) digits.push(...embedded)
    }
  }
  return digits.join('')
}

export function numberSequenceMatch(transcript, expectedSequence) {
  return extractDigitSequence(transcript) === expectedSequence
}
