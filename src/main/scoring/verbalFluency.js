import { normalizeText } from './matchers.js'

// Straight from the user's Thai MoCA-Basic form: name as many words as
// possible starting with this letter in 60 seconds. The cutoff is the
// official MoCA norm for letter fluency.
const TARGET_LETTER = 'ก'
const PASS_THRESHOLD = 11

// Fluency answers are spoken as separate words with a pause between each --
// unlike a continuous sentence, where Whisper's Thai spacing is arbitrary.
// Splitting on whitespace/punctuation to recover word boundaries relies on
// Whisper actually rendering those pauses as gaps, which is the same class of
// gamble as the หน้า/น่า/นา memory-word variants: unvalidated against real
// speech, but the least-bad option without a Thai tokenizer in this stack.
function extractWords(transcript) {
  return normalizeText(transcript)
    .split(/[\s,.!?;:]+/)
    .filter(Boolean)
}

export function scoreVerbalFluency(transcript) {
  const words = extractWords(transcript)
  // A patient who repeats a word twice does not get to count it twice.
  const distinct = [...new Set(words)]
  const qualifying = distinct.filter((word) => word.startsWith(TARGET_LETTER))

  return {
    score: qualifying.length >= PASS_THRESHOLD ? 1 : 0,
    maxScore: 1,
    wordCount: qualifying.length,
    words: qualifying
  }
}
