import { extractNumberSequence } from './matchers.js'

const START_VALUE = 100
const STEP = 7

// MoCA counts the first five subtractions and no more. A patient who keeps
// going past 65 is not penalised for it, but the extra answers earn nothing.
const MAX_SUBTRACTIONS = 5

// The official band table: 4-5 correct = 3, 2-3 = 2, 1 = 1, none = 0. Note
// that it is not linear -- the fifth subtraction is worth nothing beyond the
// fourth, and the third nothing beyond the second.
function pointsFor(correctCount) {
  if (correctCount >= 4) return 3
  if (correctCount >= 2) return 2
  if (correctCount >= 1) return 1
  return 0
}

export function scoreSerialSevens(transcript, startValue = START_VALUE) {
  const heard = extractNumberSequence(transcript)

  // Patients commonly restate the starting number before their first answer
  // ("100, 93, 86..."). Clinicians don't count that as a subtraction, so
  // neither do we. Safe to drop unconditionally: 100 can never be a correct
  // answer, since the first one must be 93.
  const answers = heard[0] === startValue ? heard.slice(1) : heard
  const spoken = answers.slice(0, MAX_SUBTRACTIONS)

  // Each subtraction is judged against what the patient actually said last,
  // not against the ideal sequence. This is the official rule and it matters:
  // a patient who slips once at 85 and then subtracts 7 correctly four more
  // times has demonstrated the attention this item measures, and scores 3.
  // Judging against the ideal 93/86/79/72/65 would give them 1.
  const subtractions = []
  let previous = startValue
  for (const answer of spoken) {
    const expected = previous - STEP
    subtractions.push({ answer, expected, correct: answer === expected })
    previous = answer
  }

  const correctCount = subtractions.filter((s) => s.correct).length

  // Answers the patient never gave are simply absent, not wrong -- stopping
  // early costs the points those subtractions would have earned and nothing
  // more.
  return { score: pointsFor(correctCount), maxScore: 3, correctCount, spoken, subtractions }
}
