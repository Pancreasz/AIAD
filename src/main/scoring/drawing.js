export function scoreTrailMaking(context) {
  const analysis = context.drawing?.analysis
  let score = 0
  let remarks = 'No analysis data found.'
  if (analysis) {
    if (!analysis.completed) {
      remarks = 'Patient did not reach the final target.'
    } else if (analysis.sequenceErrors > 0) {
      remarks = `Sequence errors detected (${analysis.sequenceErrors}).`
    } else if (analysis.lineCrossings > 0) {
      remarks = `Line crossings detected (${analysis.lineCrossings}).`
    } else {
      score = 1
      remarks = 'Perfect sequence with no line crossings.'
    }
  }
  return { score, maxScore: 1, remarks, analysis, drawingSaved: !!context.drawing }
}

export async function scoreCubeDrawing(context) {
  let score = 0
  let remarks = 'Failed to score via API.'
  try {
    if (context.drawing && context.drawing.jsonStr) {
      const res = await fetch('http://localhost:8000/cube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: context.drawing.jsonStr
      })
      if (res.ok) {
        const data = await res.json()
        score = data.score ?? 0
        if (data.details) {
          remarks = `Confidence: ${Math.round(data.confidence * 100)}% | Edges: ${data.details.edgesDetected} | Vertices: ${data.details.verticesDetected}`
        } else {
          remarks = JSON.stringify(data)
        }
      } else {
        remarks = `API returned ${res.status}: ${await res.text()}`
      }
    }
  } catch (e) {
    remarks = 'API Error: ' + e.message
  }
  return { score, maxScore: 1, remarks, drawingSaved: !!context.drawing }
}

export async function scoreClockDrawing(context) {
  let score = 0
  let remarks = 'Failed to score via API.'
  try {
    if (context.drawing && context.drawing.image) {
      const dataUrl = context.drawing.image
      const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/)
      if (matches && matches.length === 3) {
        const buffer = Buffer.from(matches[2], 'base64')
        const blob = new Blob([buffer], { type: 'image/png' })
        const formData = new FormData()
        formData.append('file', blob, 'clock.png')
        const res = await fetch('http://localhost:8000/clock', {
          method: 'POST',
          body: formData
        })
        if (res.ok) {
          const data = await res.json()
          score = data.score ?? data.predicted_moca_score ?? 0
          remarks = `Predicted MoCA Score: ${score}`
        } else {
          remarks = `API returned ${res.status}: ${await res.text()}`
        }
      }
    }
  } catch (e) {
    remarks = 'API Error: ' + e.message
  }
  return { score, maxScore: 3, remarks, drawingSaved: !!context.drawing }
}
