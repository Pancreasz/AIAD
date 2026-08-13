export function SessionResults({ results, subtests }) {
  const total = results.reduce((sum, r) => sum + r.score, 0)
  const maxTotal = results.reduce((sum, r) => sum + r.maxScore, 0)

  return (
    <div className="session-results">
      <h2>MoCA Session Results</h2>
      <table>
        <thead>
          <tr>
            <th>Subtest</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const subtest = subtests.find((s) => s.id === r.subtestId)
            return (
              <tr key={r.subtestId}>
                <td>{subtest ? subtest.section : r.subtestId}</td>
                <td>
                  {r.score} / {r.maxScore}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="total">
        Total: {total} / {maxTotal}
      </p>
    </div>
  )
}
