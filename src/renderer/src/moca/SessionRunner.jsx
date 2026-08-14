import { useEffect, useState } from 'react'
import { useSubtestSession } from './useSubtestSession.js'
import { createAudioRecorder } from './AudioRecorder.js'
import { SUBTESTS } from './subtests.js'
import { SessionResults } from '../pages/SessionResults.jsx'

// TODO(follow-on plan): replace with a real settings screen. Hardcoded here
// because this plan doesn't build session configuration — see "What's
// Deliberately Out of Scope Here" at the bottom of this plan.
const SESSION_CONTEXT = { place: 'โรงพยาบาลตัวอย่าง', province: 'กรุงเทพ' }

const ASR_LABELS = {
  loading: 'local engine loading…',
  ready: 'local (ready)',
  unavailable: 'unavailable — using cloud fallback',
  stopped: 'stopped'
}

export function SessionRunner() {
  const {
    currentSubtest,
    phase,
    results,
    error,
    beginRecording,
    finishRecording,
    retryRecording
  } = useSubtestSession(
    SUBTESTS,
    {
      transcribeAudio: (buffer, mimeType, language) =>
        window.api.transcribeAudio(buffer, mimeType, language),
      scoreItem: (subtestId, transcript, context) =>
        window.api.scoreItem(subtestId, transcript, context),
      createRecorder: createAudioRecorder
    },
    SESSION_CONTEXT
  )

  const [asrStatus, setAsrStatus] = useState('loading')

  useEffect(() => {
    let cancelled = false
    const read = async () => {
      const status = await window.api.getAsrStatus()
      if (!cancelled) setAsrStatus(status)
    }
    read()
    const interval = setInterval(read, 2000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  if (phase === 'done') {
    return <SessionResults results={results} subtests={SUBTESTS} />
  }

  if (phase === 'error') {
    return (
      <div className="session-runner">
        <h2>{currentSubtest.section}</h2>
        <p style={{ whiteSpace: 'pre-wrap' }}>{error}</p>
        <button onClick={retryRecording}>Retry</button>
      </div>
    )
  }

  return (
    <div className="session-runner">
      <p className="asr-status">ASR: {ASR_LABELS[asrStatus] ?? asrStatus}</p>
      <h2>{currentSubtest.section}</h2>
      <p>{currentSubtest.instructionTextEn}</p>
      <p lang="th">{currentSubtest.instructionTextTh}</p>
      {phase === 'instruction' && <button onClick={beginRecording}>Start</button>}
      {phase === 'recording' && <button onClick={finishRecording}>Stop &amp; Score</button>}
      {phase === 'scoring' && <p>Scoring...</p>}
    </div>
  )
}
