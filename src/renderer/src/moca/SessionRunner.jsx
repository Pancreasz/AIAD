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

// A live seconds counter for the "Record Time" and "Processing Time" labels.
// Restarts from zero whenever `active` flips true, and freezes at its last
// value when it flips false, so a caller can keep showing the final duration.
function useElapsedSeconds(active) {
  const [ms, setMs] = useState(0)
  const [wasActive, setWasActive] = useState(active)
  // Reset during render when `active` flips -- React's documented "adjust state
  // while rendering" pattern -- so the counter starts from 0 without a
  // setState call inside the effect body.
  if (active !== wasActive) {
    setWasActive(active)
    setMs(0)
  }
  useEffect(() => {
    if (!active) return
    const start = Date.now()
    const id = setInterval(() => setMs(Date.now() - start), 100)
    return () => clearInterval(id)
  }, [active])
  return (ms / 1000).toFixed(1)
}

export function SessionRunner() {
  const {
    currentSubtest,
    phase,
    results,
    error,
    countdownValue,
    index,
    total,
    isLastSubtest,
    beginSubtest,
    finishRecording,
    finishDrawing,
    retryRecording,
    skipSubtest,
    continueToNext,
    resetSession,
    recordTap
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
  const recordSeconds = useElapsedSeconds(phase === 'recording')
  const processSeconds = useElapsedSeconds(phase === 'scoring')

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

  if (phase === 'done') {
    return <SessionResults results={results} subtests={SUBTESTS} onRestart={resetSession} />
  }

  const stepNumber = Math.min(index + 1, total)
  const asrLabel = ASR_LABELS[asrStatus] ?? asrStatus

  // Visuospatial subtests take over the stage with a drawing canvas. The
  // component captures the drawing and calls finishDrawing() when the patient
  // presses Finish; the session header stays above it for continuity with
  // every other subtest (progress, step count).
  if (phase === 'clock-drawing' || phase === 'cube-drawing' || phase === 'trail-making') {
    return (
      <div className="session-runner">
        <SessionHeader
          section={currentSubtest.section}
          stepNumber={stepNumber}
          total={total}
          asrLabel={asrLabel}
        />
        {phase === 'trail-making' ? (
          <TrailMaking
            onFinish={finishDrawing}
            instructionEn={currentSubtest.instructionTextEn}
            instructionTh={currentSubtest.instructionTextTh}
          />
        ) : (
          <DrawingTest
            testId={phase.split('-')[0]}
            onFinish={finishDrawing}
            instructionEn={currentSubtest.instructionTextEn}
            instructionTh={currentSubtest.instructionTextTh}
          />
        )}
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="session-runner">
        <SessionHeader
          section={currentSubtest.section}
          stepNumber={stepNumber}
          total={total}
          asrLabel={asrLabel}
        />
        <div className="stage stage--error">
          <p className="stage__status stage__status--error">Something went wrong</p>
          <p className="error-detail">{error}</p>
          <div className="stage__actions">
            <button className="btn btn--primary" onClick={retryRecording}>
              Retry
            </button>
            <button className="btn btn--ghost" onClick={skipSubtest}>
              Skip this test
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'complete') {
    const last = results[results.length - 1]
    return (
      <div className="session-runner">
        <SessionHeader
          section={currentSubtest.section}
          stepNumber={stepNumber}
          total={total}
          asrLabel={asrLabel}
        />
        <div className="stage stage--complete">
          <div className="success-badge" aria-hidden="true">
            ✓
          </div>
          <p className="stage__status stage__status--success">Success</p>
          <p className="complete-score">{formatOutcome(last)}</p>
          <div className="stage__actions">
            <button className="btn btn--primary" onClick={continueToNext}>
              {isLastSubtest ? 'See results →' : 'Next test →'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const isTap = currentSubtest.responseMode === 'tap'

  // The countdown markup, shared between the block form (ASR tests, where it is
  // the only thing on stage) and the overlay form (tap tests, where it sits on
  // top of the tap box so the box does not shift down while counting).
  const renderCountdown = (overlay) => (
    <div
      className={`countdown${overlay ? ' countdown--overlay' : ''}`}
      role="status"
      aria-live="assertive"
    >
      {countdownValue > 0 ? (
        <span key={countdownValue} className="countdown__number">
          {countdownValue}
        </span>
      ) : (
        <span className="countdown__go">
          <span lang="th">เริ่ม!</span>
          <span className="countdown__go-en">Start!</span>
        </span>
      )}
    </div>
  )

  return (
    <div className="session-runner">
      <SessionHeader
        section={currentSubtest.section}
        stepNumber={stepNumber}
        total={total}
        asrLabel={asrLabel}
      />

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

      <div className="instructions">
        <p className="instructions__en">{currentSubtest.instructionTextEn}</p>
        <p className="instructions__th" lang="th">
          {currentSubtest.instructionTextTh}
        </p>
      </div>

      <div className="stage">
        {phase === 'instruction' && (
          <div className="stage__actions">
            <button className="btn btn--primary btn--lg" onClick={beginSubtest}>
              Start
            </button>
          </div>
        )}

        {phase === 'stimulus' && (
          <p className="stage__status stage__status--listen">
            <span className="pulse-dot" aria-hidden="true" />
            Listen…
          </p>
        )}

        {/* ASR tests have no tap box, so the countdown is the stage's main
            content. Tap tests render it as an overlay on the box instead
            (below) so the box stays put. */}
        {phase === 'countdown' && !isTap && renderCountdown(false)}

        {phase === 'recording' && (
          <div className="stage__recording">
            <p className="stage__status stage__status--record">
              <span className="rec-dot" aria-hidden="true" />
              Recording · <span className="timer">{recordSeconds}s</span>
            </p>
            <button className="btn btn--primary btn--lg" onClick={finishRecording}>
              Stop &amp; Score
            </button>
          </div>
        )}

        {phase === 'scoring' && (
          <p className="stage__status stage__status--process">
            <span className="spinner" aria-hidden="true" />
            Processing · <span className="timer">{processSeconds}s</span>
          </p>
        )}

        {(phase === 'tapping' || (isTap && (phase === 'stimulus' || phase === 'countdown'))) && (
          // Visible from the moment the stimulus phase starts, and stays
          // visible through the countdown -- inert until the first digit's
          // onset, not absent -- so a self-administering patient has the whole
          // lead-in (guidance + countdown) to notice and locate the control
          // instead of ~2 seconds after the first target digit appears.
          // Enabled and wired to recordTap only once tapping starts.
          // No progress indicator, no digit counter, no per-tap
          // acknowledgement: feedback would turn a sustained-attention task
          // into a tracking task, and showing how many digits remain gives
          // away how many targets are left.
          //
          // The countdown renders as an overlay inside this same box (rather
          // than as a sibling above it) so counting down does not push the box
          // down and move the tap target out from under the patient's finger.
          <div className="tap-zone">
            <button
              className="tap-target"
              disabled={phase !== 'tapping'}
              onPointerDown={phase === 'tapping' ? recordTap : undefined}
            >
              {/* Thai, like every other patient-facing string. The instruction
                  names the space bar; this is the visible fallback for anyone
                  who reaches for the mouse, and it also shows the patient where
                  the task is happening. */}
              <span lang="th">กดที่นี่</span>
            </button>
            {phase === 'countdown' && renderCountdown(true)}
          </div>
        )}

        {/* Skip stays reachable through the voice guidance, the countdown, the
            tap sequence, and processing -- a media element that stalls without
            erroring never settles play(), and processing can hang on the
            engine, so Skip is the escape hatch in every non-interactive
            phase. */}
        {(phase === 'stimulus' ||
          phase === 'countdown' ||
          phase === 'tapping' ||
          phase === 'scoring') && (
          <div className="stage__skip">
            <button className="btn btn--ghost" onClick={skipSubtest}>
              Skip this test
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function SessionHeader({ section, stepNumber, total, asrLabel }) {
  return (
    <header className="session-header">
      <div className="session-header__top">
        <span className="step-badge">
          Test {stepNumber} of {total}
        </span>
        <span className="asr-status">ASR: {asrLabel}</span>
      </div>
      <h2 className="session-header__title">{section}</h2>
      <div className="progress-track" aria-hidden="true">
        <div className="progress-track__fill" style={{ width: `${(stepNumber / total) * 100}%` }} />
      </div>
    </header>
  )
}

// The one-line outcome shown on the Success screen. Mirrors the wording the
// results table uses so a patient sees the same phrasing twice.
function formatOutcome(result) {
  if (!result) return ''
  if (result.recalledCount !== undefined && result.maxScore === 0) {
    return `${result.recalledCount} of 5 recalled`
  }
  if (typeof result.score === 'number' && typeof result.maxScore === 'number') {
    return `Scored ${result.score} / ${result.maxScore}`
  }
  return 'Recorded'
}
