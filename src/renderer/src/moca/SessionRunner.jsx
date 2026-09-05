import { useEffect, useState } from 'react'
import { useSubtestSession } from './useSubtestSession.js'
import { createAudioRecorder } from './AudioRecorder.js'
import { createAudioPlayer } from './AudioPlayer.js'
import { createDigitSequencePlayer } from './DigitSequencePlayer.js'
import { SUBTESTS } from './subtests.js'
import { SessionResults } from '../pages/SessionResults.jsx'
import { DrawingTest } from '../components/DrawingTest.jsx'
import { TrailMaking } from '../components/TrailMaking.jsx'

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

// Created once at module scope: it holds no state between calls, and a new
// instance per render would be pointless churn.
const audioPlayer = createAudioPlayer()

// Module scope for the same reason audioPlayer is: it holds preloaded audio
// elements, and rebuilding it per render would re-download every digit.
const digitSequencePlayer = createDigitSequencePlayer()

export function SessionRunner() {
  const {
    currentSubtest,
    phase,
    results,
    error,
    beginSubtest,
    finishRecording,
    retryRecording,
    skipSubtest,
    recordTap,
    finishDrawing,
    continueNextSubtest,
    pendingResult
  } = useSubtestSession(
    SUBTESTS,

    {
      transcribeAudio: (buffer, mimeType, language) =>
        window.api.transcribeAudio(buffer, mimeType, language),
      scoreItem: (subtestId, transcript, context) =>
        window.api.scoreItem(subtestId, transcript, context),
      createRecorder: createAudioRecorder,
      playAudio: (src) => audioPlayer.play(src),
      stopAudio: () => audioPlayer.stop(),
      preloadDigits: (digits) => digitSequencePlayer.preload(digits),
      playDigitSequence: (sequence, options) => digitSequencePlayer.play(sequence, options),
      stopDigitSequence: () => digitSequencePlayer.stop()
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

  useEffect(() => {
    if (phase !== 'tapping') return
    const onKeyDown = (event) => {
      if (event.code !== 'Space') return
      // A held key auto-repeats at ~30Hz once the OS kicks in, which would
      // drop a tap into every remaining window -- a guaranteed zero on an
      // item that allows at most one error.
      if (event.repeat) return
      // Otherwise the browser also treats it as a click on whatever is
      // focused, double-counting a tap.
      event.preventDefault()
      recordTap()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [phase, recordTap])

  const handleResetSession = () => {
    if (window.confirm('Are you sure you want to completely restart the session?')) {
      localStorage.removeItem('moca_session_index')
      localStorage.removeItem('moca_session_phase')
      localStorage.removeItem('moca_session_results')
      window.location.reload()
    }
  }

  const GlobalResetButton = () => (
    <button 
      onClick={handleResetSession} 
      style={{
        position: 'fixed',
        bottom: '20px',
        left: '20px',
        zIndex: 99999,
        background: 'rgba(0,0,0,0.5)',
        color: 'white',
        border: 'none',
        padding: '8px 12px',
        borderRadius: '4px',
        cursor: 'pointer'
      }}
    >
      Restart Session
    </button>
  )

  if (phase === 'clock-drawing' || phase === 'cube-drawing') {
    return (
      <>
        <DrawingTest testId={phase.split('-')[0]} onFinish={finishDrawing} instructionEn={currentSubtest.instructionTextEn} instructionTh={currentSubtest.instructionTextTh} />
        <GlobalResetButton />
      </>
    )
  }

  if (phase === 'trail-making') {
    return (
      <>
        <TrailMaking onFinish={finishDrawing} instructionEn={currentSubtest.instructionTextEn} instructionTh={currentSubtest.instructionTextTh} />
        <GlobalResetButton />
      </>
    )
  }

  if (phase === 'done') {
    return (
      <>
        <SessionResults results={results} subtests={SUBTESTS} />
        <GlobalResetButton />
      </>
    )
  }

  if (phase === 'score-review') {
    return (
      <div className="session-runner">
        <h2>{currentSubtest.section} - Result</h2>
        <div style={{ padding: '20px', background: '#f5f5f5', borderRadius: '8px', margin: '20px 0' }}>
          <h3>Score: {pendingResult?.score} / {pendingResult?.maxScore}</h3>
          <p><strong>Remarks:</strong> {pendingResult?.remarks || 'None'}</p>
          {pendingResult?.analysis && (
            <pre style={{ textAlign: 'left', background: '#eee', padding: '10px' }}>
              {JSON.stringify(pendingResult.analysis, null, 2)}
            </pre>
          )}
        </div>
        <button className="moca-button" onClick={continueNextSubtest}>Continue to Next Subtest</button>
        <GlobalResetButton />
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="session-runner">
        <h2>{currentSubtest.section}</h2>
        <p style={{ whiteSpace: 'pre-wrap' }}>{error}</p>
        <button onClick={retryRecording}>Retry</button>
        <button onClick={skipSubtest}>Skip this subtest</button>
        <GlobalResetButton />
      </div>
    )
  }

  return (
    <div className="session-runner">
      <GlobalResetButton />

      <p className="asr-status">ASR: {ASR_LABELS[asrStatus] ?? asrStatus}</p>
      <h2>{currentSubtest.section}</h2>
      {currentSubtest.images && (
        <div className="subtest-images">
          {currentSubtest.images.map((src, i) => (
            <img
              key={src}
              src={src}
              // Neutral on purpose — naming the animal here would give away
              // the answer via screen readers or a broken-image fallback.
              alt={`Animal ${i + 1} of ${currentSubtest.images.length}`}
            />
          ))}
        </div>
      )}
      <p>{currentSubtest.instructionTextEn}</p>
      <p lang="th">{currentSubtest.instructionTextTh}</p>
      {phase === 'instruction' && <button onClick={beginSubtest}>Start</button>}
      {phase === 'stimulus' && <p>Listen…</p>}
      {phase === 'recording' && <button onClick={finishRecording}>Stop &amp; Score</button>}
      {phase === 'scoring' && <p>Scoring...</p>}
      {(phase === 'tapping' || (phase === 'stimulus' && currentSubtest.responseMode === 'tap')) && (
        // Visible from the moment the stimulus phase starts -- inert until
        // the first digit's onset, not absent -- so a self-administering
        // patient has the whole one-second lead-in to notice and locate the
        // control instead of ~2 seconds after the first target digit
        // appears. Enabled and wired to recordTap only once tapping starts.
        // No progress indicator, no digit counter, no per-tap
        // acknowledgement: feedback would turn a sustained-attention task
        // into a tracking task, and showing how many digits remain gives
        // away how many targets are left.
        <button
          className="tap-target"
          disabled={phase !== 'tapping'}
          onPointerDown={phase === 'tapping' ? recordTap : undefined}
        >
          {/* Thai, like every other patient-facing string. The instruction
              names the space bar; this is the visible fallback for anyone who
              reaches for the mouse, and it also shows the patient where the
              task is happening. */}
          <span lang="th">กดที่นี่</span>
        </button>
      )}
      {(phase === 'stimulus' || phase === 'tapping') && (
        // A media element that stalls without erroring never settles the
        // play() promise, leaving phase stuck here forever. Skip is the
        // escape hatch -- the same one the error phase already offers.
        <button onClick={skipSubtest}>Skip this subtest</button>
      )}
    </div>
  )
}
