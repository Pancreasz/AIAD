import { extractDigitSequence } from './matchers.js'

export function scoreDigitSpan(transcript, expectedSequence) {
  const spoken = extractDigitSequence(transcript)
  const correct = spoken === expectedSequence
  return { score: correct ? 1 : 0, maxScore: 1, spoken, expected: expectedSequence }
}
