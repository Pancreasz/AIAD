import { normalizeText, keywordMatch } from './matchers.js'

// The five words on the Thai MoCA-Basic form, in reading order:
// หน้า (face), ผ้าไหม (silk), วัด (temple), มะลิ (jasmine), สีแดง (red).
//
// Registration and delayed recall MUST check identical content, so they share
// this one constant rather than each holding a copy that could drift.
//
// The หน้า variants are deliberate: it is a single syllable whose tonal
// neighbours (นา field, น่า should) are common words, and Whisper's Thai is
// the weakest part of this stack. Accepting them trades a rare false positive
// for a much likelier false negative. Revisit with real recordings.
const ACCEPTED_WORD_TERMS = {
  face: ['หน้า', 'น่า', 'นา'],
  silk: ['ผ้าไหม', 'ไหม'],
  temple: ['วัด'],
  jasmine: ['มะลิ'],
  red: ['สีแดง', 'แดง']
}

function matchWords(transcript) {
  const normalized = normalizeText(transcript)
  const results = {}
  let recalledCount = 0
  for (const [word, terms] of Object.entries(ACCEPTED_WORD_TERMS)) {
    const correct = keywordMatch(normalized, terms)
    results[word] = { correct }
    if (correct) recalledCount += 1
  }
  return { recalledCount, results }
}

// MoCA awards no points for registration. The count is captured as process
// data -- it separates "never encoded" from "encoded but lost" -- but must
// not affect the total.
export function scoreMemoryRegistration(transcript) {
  const { recalledCount, results } = matchWords(transcript)
  return { score: 0, maxScore: 0, recalledCount, results }
}

export function scoreDelayedRecall(transcript) {
  const { recalledCount, results } = matchWords(transcript)
  return { score: recalledCount, maxScore: 5, recalledCount, results }
}
