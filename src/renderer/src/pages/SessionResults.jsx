const PROTOCOL_RECALL_GAP_MS = 5 * 60 * 1000

function formatGap(ms) {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds}s`
}

// Registration "happened" if at least one trial actually ran -- i.e. a
// memory-registration result exists and was not skipped. If neither trial
// qualifies, the patient was never played the five words, so a delayed-recall
// score would measure nothing.
function registrationHappened(results) {
  return results.some(
    (r) => typeof r.subtestId === 'string' && r.subtestId.startsWith('memory-registration') && !r.skipped
  )
}

// A delayed-recall result is unscorable -- not merely low-scoring -- when
// registration never happened. This is distinct from `skipped`: the recall
// subtest itself ran and produced a transcript, but the number it produced
// doesn't measure recall of anything, since nothing was ever presented to
// recall. Excluded from both sides of the total for the same reason a
// skipped row is.
function isUnscorableRecall(result, results) {
  return result.subtestId === 'delayed-recall' && !result.skipped && !registrationHappened(results)
}

// MoCA expects roughly five minutes between the last registration trial and
// delayed recall. We measure rather than enforce -- a blocking wait reads as a
// hung app -- so the interval is displayed and flagged when it falls short.
function recallInterval(results) {
  const registration = results.find((r) => r.subtestId === 'memory-registration-2')
  const recall = results.find((r) => r.subtestId === 'delayed-recall')
  if (!registration?.completedAt || !recall?.completedAt) return null
  // A skipped subtest was never administered, so its completedAt marks the
  // moment it was skipped, not a real measurement. Diffing it against the
  // other anchor would fabricate an interval for a recall (or registration)
  // that never happened.
  if (registration.skipped || recall.skipped) return null

  const elapsedMs = recall.completedAt - registration.completedAt
  return { text: formatGap(elapsedMs), short: elapsedMs < PROTOCOL_RECALL_GAP_MS }
}

export function SessionResults({ results, subtests }) {
  const total = results.reduce(
    (sum, r) => (isUnscorableRecall(r, results) ? sum : sum + r.score),
    0
  )
  const maxTotal = results.reduce(
    (sum, r) => (isUnscorableRecall(r, results) ? sum : sum + r.maxScore),
    0
  )
  const interval = recallInterval(results)
  const skippedCount = results.filter((r) => r.skipped).length

  return (
    <div className="session-results">
      <h2>MoCA Session Results</h2>
      <table>
        <thead>
          <tr>
            <th>Subtest</th>
            <th>Score</th>
            <th>Engine</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const subtest = subtests.find((s) => s.id === r.subtestId)
            // MoCA awards no points for memory registration, so those rows
            // report the count as information rather than as a score.
            const unscored = r.maxScore === 0 && r.recalledCount !== undefined
            const unscorableRecall = isUnscorableRecall(r, results)
            return (
              <tr key={r.subtestId}>
                <td>{subtest ? subtest.section : r.subtestId}</td>
                <td>
                  {r.skipped
                    ? 'skipped'
                    : unscorableRecall
                      ? 'not scorable — words never presented'
                      : unscored
                        ? `${r.recalledCount} of 5 recalled`
                        : `${r.score} / ${r.maxScore}`}
                </td>
                <td>{r.engine ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="total">
        Total: {total} / {maxTotal}
      </p>
      {skippedCount > 0 && (
        <p className="skipped-note">
          {skippedCount} subtest{skippedCount === 1 ? '' : 's'} not administered — this total is
          incomplete
        </p>
      )}
      {interval && (
        <p className="recall-interval">
          Delayed recall after {interval.text}
          {interval.short && ' — under the 5 minute protocol interval, so this score is not comparable to published norms'}
        </p>
      )}
    </div>
  )
}
