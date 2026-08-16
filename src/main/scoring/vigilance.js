// MoCA gives the point for zero or one errors. There is no partial credit --
// the item is worth 1 and scores 1 or 0.
const MAX_ERRORS_FOR_POINT = 1

export function scoreVigilance(taps = [], { sequence, target, intervalMs }) {
  const digits = [...sequence]

  // A tap belongs to the digit whose window it lands in: digit i owns
  // [i * intervalMs, (i + 1) * intervalMs). Taps outside the sequence are
  // dropped rather than charged -- the tap control is inert then, so any that
  // arrive are an artefact, not a patient error.
  const firstTapByWindow = new Map()
  for (const tap of taps) {
    if (tap < 0) continue
    const index = Math.floor(tap / intervalMs)
    if (index >= digits.length) continue
    // First tap only. A second tap in the same window is the same mistake
    // about the same digit, and the first one is the reaction time.
    if (!firstTapByWindow.has(index)) firstTapByWindow.set(index, tap)
  }

  let hits = 0
  let misses = 0
  let falseTaps = 0
  const tapLatencies = []

  digits.forEach((digit, index) => {
    const tap = firstTapByWindow.get(index)
    if (digit === target) {
      if (tap === undefined) {
        misses += 1
      } else {
        hits += 1
        // Measured from this target's own onset, so the value is a reaction
        // time rather than a position in the sequence.
        tapLatencies.push(tap - index * intervalMs)
      }
    } else if (tap !== undefined) {
      falseTaps += 1
    }
  })

  const errors = misses + falseTaps

  return {
    score: errors <= MAX_ERRORS_FOR_POINT ? 1 : 0,
    maxScore: 1,
    errors,
    hits,
    misses,
    falseTaps,
    tapLatencies
  }
}
