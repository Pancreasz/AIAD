import { normalizeText, keywordMatch } from './matchers.js'

const THAI_MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม'
]

const THAI_DAYS = [
  'วันอาทิตย์',
  'วันจันทร์',
  'วันอังคาร',
  'วันพุธ',
  'วันพฤหัสบดี',
  'วันศุกร์',
  'วันเสาร์'
]

export function scoreOrientation(transcript, context) {
  const { referenceDate, place, province } = context
  const normalized = normalizeText(transcript)

  // Thai MoCA forms use the Buddhist Era (BE = CE + 543), not the Gregorian year.
  const items = {
    day: THAI_DAYS[referenceDate.getDay()],
    month: THAI_MONTHS[referenceDate.getMonth()],
    year: String(referenceDate.getFullYear() + 543),
    date: String(referenceDate.getDate()),
    place,
    province
  }

  const results = {}
  let score = 0
  for (const [key, expected] of Object.entries(items)) {
    const correct = keywordMatch(normalized, [expected])
    results[key] = { expected, correct }
    if (correct) score += 1
  }

  return { score, maxScore: 6, results }
}
