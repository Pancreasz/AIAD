import { normalizeText, keywordMatch } from './matchers.js'

const ACCEPTED_ANIMAL_TERMS = {
  lion: ['สิงโต', 'lion'],
  rhino: ['แรด', 'rhino', 'rhinoceros'],
  camel: ['อูฐ', 'camel']
}

export function scoreNaming(transcript) {
  const normalized = normalizeText(transcript)
  const results = {}
  let score = 0
  for (const [animal, terms] of Object.entries(ACCEPTED_ANIMAL_TERMS)) {
    const correct = keywordMatch(normalized, terms)
    results[animal] = { correct }
    if (correct) score += 1
  }
  return { score, maxScore: 3, results }
}
