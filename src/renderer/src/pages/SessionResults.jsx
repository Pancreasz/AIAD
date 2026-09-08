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
    (r) =>
      typeof r.subtestId === 'string' && r.subtestId.startsWith('memory-registration') && !r.skipped
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

// Process data a paper form throws away. The tap subtest reports hit/miss
// counts, verbal fluency its word count, and the drawing subtests the remark
// their scorer produced (predicted clock score, cube confidence, trail-making
// errors). `responseMs` is deliberately excluded because it measures how long
// the microphone was open, which includes an operator's hand on the Stop
// button and so is not comparable between subtests, let alone between patients.
function processData(result) {
  if (result.skipped) return null

  if (typeof result.wordCount === 'number') {
    return `${result.wordCount} word${result.wordCount === 1 ? '' : 's'} starting with ก`
  }

  if (typeof result.hits === 'number') {
    const counts = `${result.hits} hits, ${result.misses} misses, ${result.falseTaps} false taps`
    const latencies = result.tapLatencies ?? []
    if (!latencies.length) return counts

    const mean = Math.round(latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length)
    return `${counts} · ${mean} ms mean`
  }

  // Drawing subtests: surface the scorer's own remark verbatim.
  if (typeof result.remarks === 'string' && result.remarks) return result.remarks

  return null
}

export function SessionResults({ results, subtests, onRestart }) {
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
      <header className="results-header">
        <h2>MoCA Session Results</h2>
        <p className="results-total">
          <span className="results-total__value">
            Total: {total} / {maxTotal}
          </span>
        </p>
      </header>

      <div className="results-table-wrap">
        <table className="results-table">
          <thead>
            <tr>
              <th className="col-subtest">Subtest</th>
              <th className="col-score">Score</th>
              <th className="col-engine">Engine</th>
              <th className="col-process">Process data</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const subtest = subtests.find((s) => s.id === r.subtestId)
              // MoCA awards no points for memory registration, so those rows
              // report the count as information rather than as a score.
              const unscored = r.maxScore === 0 && r.recalledCount !== undefined
              const unscorableRecall = isUnscorableRecall(r, results)
              const rowClass = r.skipped
                ? 'row--skipped'
                : unscorableRecall
                  ? 'row--unscorable'
                  : ''
              return (
                <tr key={r.subtestId} className={rowClass}>
                  <td className="col-subtest">{subtest ? subtest.section : r.subtestId}</td>
                  <td className="col-score">
                    {r.skipped ? (
                      <span className="pill pill--skipped">skipped</span>
                    ) : unscorableRecall ? (
                      <span className="pill pill--warn">not scorable — words never presented</span>
                    ) : unscored ? (
                      <span className="pill pill--info">{r.recalledCount} of 5 recalled</span>
                    ) : (
                      <span className="score-value">
                        {r.score} / {r.maxScore}
                      </span>
                    )}
                  </td>
                  <td className="col-engine">{r.engine ?? '—'}</td>
                  {/* Empty rather than a dash: a subtest that produces no process
                      data is not missing a value, and a dash here would also
                      collide with the engine column's own placeholder. */}
                  <td className="col-process process-data">{processData(r)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="results-notes">
        {skippedCount > 0 && (
          <p className="note note--warn skipped-note">
            {skippedCount} subtest{skippedCount === 1 ? '' : 's'} not administered — this total is
            incomplete
          </p>
        )}
        {interval && (
          <p className={`note recall-interval${interval.short ? ' note--warn' : ' note--ok'}`}>
            Delayed recall after {interval.text}
            {interval.short &&
              ' — under the 5 minute protocol interval, so this score is not comparable to published norms'}
          </p>
        )}
      </div>

      <div className="results-actions">
        <button className="btn btn--primary btn--lg" onClick={onRestart}>
          ↻ Restart from the first test
        </button>
      </div>
    </div>
  )
}
