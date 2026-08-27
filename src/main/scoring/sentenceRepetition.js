import { exactMatchIgnoringSpaces } from './matchers.js'

// One point per sentence, all or nothing -- MoCA gives no partial credit for
// a repetition with an omission or substitution. Straight from the user's
// Thai MoCA-Basic form.
const EXPECTED_SENTENCES = {
  'sentence-repetition-1': 'ฉันรู้ว่าจอมเป็นคนเดียวที่มาช่วยงานวันนี้',
  'sentence-repetition-2': 'แมวมักซ่อนตัวอยู่หลังเก้าอี้เมื่อมีหมาอยู่ในห้อง'
}

export function scoreSentenceRepetition(transcript, itemId) {
  const expected = EXPECTED_SENTENCES[itemId]
  // A typo in a subtest id would otherwise score every patient zero on a
  // sentence that was never really administered, and look like a clinical
  // finding.
  if (!expected) throw new Error(`No expected sentence registered for item "${itemId}"`)

  return { score: exactMatchIgnoringSpaces(transcript, expected) ? 1 : 0, maxScore: 1 }
}
