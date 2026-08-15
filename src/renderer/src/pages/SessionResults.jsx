const PROTOCOL_RECALL_GAP_MS = 5 * 60 * 1000

function formatGap(ms) {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds}s`
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
  const total = results.reduce((sum, r) => sum + r.score, 0)
  const maxTotal = results.reduce((sum, r) => sum + r.maxScore, 0)
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
            return (
              <tr key={r.subtestId}>
                <td>{subtest ? subtest.section : r.subtestId}</td>
                <td>
                  {r.skipped
                    ? 'skipped'
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
          {skippedCount} subtest{skippedCount === 1 ? '' : 's'} skipped — this total is not
          comparable to the full 30-point scale
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
