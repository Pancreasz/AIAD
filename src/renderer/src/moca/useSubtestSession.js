import { useState, useCallback, useRef, useEffect } from 'react'

// Real countdown/"Start!" pacing. Injected so tests can run instantly and so a
// slow machine's timer drift never changes what a subtest measures.
const defaultDelay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// How long the big "เริ่ม! / Start!" flashes after the count reaches zero,
// before the mic opens or the digit sequence begins.
const START_FLASH_MS = 600

// The three visuospatial subtests answered by drawing on a canvas rather than
// by speech or a tap. Each hands the stage to a drawing component that calls
// finishDrawing() when the patient is done.
const DRAWING_RESPONSE_MODES = new Set(['clock-drawing', 'cube-drawing', 'trail-making'])

export function useSubtestSession(
  subtests,
  {
    transcribeAudio,
    scoreItem,
    createRecorder,
    playAudio,
    stopAudio,
    preloadDigits,
    playDigitSequence,
    stopDigitSequence,
    delay = defaultDelay
  },
  sessionContext = {}
) {
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState('instruction')
  const [results, setResults] = useState([])
  const [error, setError] = useState(null)
  // The big number shown during the pre-response countdown. `0` is the "Start!"
  // flash; `null` means no countdown is running.
  const [countdownValue, setCountdownValue] = useState(null)
  const recorderRef = useRef(null)
  const generationRef = useRef(0)
  const recordingStartedAtRef = useRef(null)
  const tapsRef = useRef([])
  const sequenceStartedAtRef = useRef(null)

  const currentSubtest = subtests[index]
  const isLastSubtest = index + 1 >= subtests.length

  // Append a result and pause on the "Success" screen. Advancing is a separate
  // step (continueToNext) so the operator/patient sees the subtest landed
  // before the next one begins. The hook's own fields are written after the
  // scorer's spread so a scorer can never overwrite subtestId, transcript, or
  // engine.
  const completeSubtest = useCallback(
    (scoreResult, fields) => {
      setResults((prev) => [
        ...prev,
        {
          ...scoreResult,
          subtestId: currentSubtest.id,
          timeLimitSec: currentSubtest.timeLimitSec || null,
          completedAt: Date.now(),
          ...fields
        }
      ])
      setPhase('complete')
    },
    [currentSubtest]
  )

  // Leave the "Success" screen for the next subtest, or the results if this was
  // the last one.
  const continueToNext = useCallback(() => {
    setCountdownValue(null)
    if (index + 1 < subtests.length) {
      setIndex((prev) => prev + 1)
      setPhase('instruction')
    } else {
      setPhase('done')
    }
  }, [index, subtests.length])

  // The pre-response countdown: a big 3-2-1 after the voice guidance ends, then
  // a "Start!" flash, then the caller opens the mic or starts the digit
  // sequence. Returns false if the attempt was abandoned mid-count, so the
  // caller bails instead of proceeding for a subtest nobody is on any more.
  const runCountdown = useCallback(
    async (seconds, abandoned) => {
      if (!seconds) return true
      setPhase('countdown')
      for (let n = seconds; n >= 1; n--) {
        setCountdownValue(n)
        await delay(1000)
        if (abandoned()) return false
      }
      // Zero is the "Start!" flash rather than a shown digit.
      setCountdownValue(0)
      await delay(START_FLASH_MS)
      if (abandoned()) return false
      setCountdownValue(null)
      return true
    },
    [delay]
  )

  // Vigilance only. No recorder is created and no transcription happens: the
  // answer is when the patient tapped, not anything they said.
  const runTapSequence = useCallback(
    async (abandoned) => {
      const distinctDigits = [...new Set(currentSubtest.sequence)]
      await preloadDigits(distinctDigits)
      if (abandoned()) return

      tapsRef.current = []

      await playDigitSequence(currentSubtest.sequence, {
        intervalMs: currentSubtest.intervalMs,
        leadInMs: currentSubtest.leadInMs,
        onStart: () => {
          if (abandoned()) return
          // The origin for every tap offset. Set here rather than at Start,
          // because the lead-in silence sits in between and a tap during it
          // is not an answer to any digit.
          sequenceStartedAtRef.current = Date.now()
          setPhase('tapping')
        }
      })
      if (abandoned()) return

      setPhase('scoring')
      const taps = tapsRef.current
      const responseMs = Date.now() - sequenceStartedAtRef.current
      const scoreResult = await scoreItem(currentSubtest.scorerId, '', {
        taps,
        sequence: currentSubtest.sequence,
        target: currentSubtest.target,
        intervalMs: currentSubtest.intervalMs,
        referenceDate: new Date(),
        ...sessionContext
      })
      if (abandoned()) return

      // The tap path's counterpart to the [ASR] block below. Without it this
      // subtest is silent during a manual run: it shows no per-tap feedback by
      // clinical design, so a developer watching a session has no way to tell a
      // working run from one where nothing registered -- both look identical
      // until the results table, which only prints the final point.
      if (import.meta.env.MODE !== 'test') {
        const targetCount = [...currentSubtest.sequence].filter(
          (d) => d === currentSubtest.target
        ).length
        const latencies = scoreResult.tapLatencies ?? []
        const mean = latencies.length
          ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
          : null
        console.log(
          `[TAP] ${currentSubtest.id}\n` +
            `  taps:     ${taps.length} at ${JSON.stringify(taps)}\n` +
            `  hits:     ${scoreResult.hits}/${targetCount}\n` +
            `  misses:   ${scoreResult.misses}\n` +
            `  false:    ${scoreResult.falseTaps}\n` +
            `  errors:   ${scoreResult.errors} (1 point if 1 or fewer)\n` +
            `  score:    ${scoreResult.score}/${scoreResult.maxScore}\n` +
            `  latency:  ${mean === null ? 'n/a' : `${mean}ms mean`} ${JSON.stringify(latencies)}`,
          scoreResult
        )
      }

      completeSubtest(scoreResult, {
        transcript: '',
        // No ASR ran. SessionResults already renders `engine ?? '—'`.
        engine: null,
        responseMs
      })
    },
    [currentSubtest, preloadDigits, playDigitSequence, scoreItem, sessionContext, completeSubtest]
  )

  // Retire the in-flight attempt: bump the generation so its continuation
  // bails, and silence any file it left playing -- otherwise a skipped
  // stimulus keeps sounding over the next subtest.
  const abandonAttempt = useCallback(() => {
    generationRef.current += 1
    setCountdownValue(null)
    if (stopAudio) stopAudio()
    if (stopDigitSequence) stopDigitSequence()
  }, [stopAudio, stopDigitSequence])

  const beginSubtest = useCallback(async () => {
    // Retire any attempt still in flight before claiming a generation. Doing
    // this inline used to bump the counter without stopping the player, so a
    // second Start left the previous sequence's timers running and two digit
    // streams played over each other.
    abandonAttempt()
    const generation = generationRef.current
    const abandoned = () => generationRef.current !== generation

    try {
      // Instruction first, then stimulus, then the mic -- the order a
      // clinician administers in. The mic must not open until BOTH have
      // finished: if playback overlaps recording, the ASR transcribes the
      // app's own voice and the subtest appears to pass while measuring
      // nothing.
      if (currentSubtest.instructionAudio || currentSubtest.audio) {
        setPhase('stimulus')
      }
      if (currentSubtest.instructionAudio) {
        await playAudio(currentSubtest.instructionAudio)
        if (abandoned()) return
      }
      if (currentSubtest.audio) {
        await playAudio(currentSubtest.audio)
        if (abandoned()) return
      }

      // Countdown after the voice guidance ends, before any response is
      // recorded. Skipped entirely when a subtest declares no countdown.
      if (!(await runCountdown(currentSubtest.countdownSec, abandoned))) return

      if (currentSubtest.responseMode === 'tap') {
        await runTapSequence(abandoned)
        return
      }

      // Visuospatial subtests have no mic and no digit sequence: hand the
      // stage to the canvas component (phase === the responseMode), which
      // calls finishDrawing() when the patient presses Finish. Timed from
      // here so responseMs covers the whole drawing attempt.
      if (DRAWING_RESPONSE_MODES.has(currentSubtest.responseMode)) {
        recordingStartedAtRef.current = Date.now()
        setPhase(currentSubtest.responseMode)
        return
      }

      const recorder = createRecorder()
      await recorder.start()
      if (abandoned()) {
        // The mic opened for a subtest nobody is on any more. Close it rather
        // than leaving the stream live and the recorder unreachable.
        await recorder.stop()
        return
      }
      recorderRef.current = recorder
      // Measured from the mic opening, so stimulus playback is excluded.
      recordingStartedAtRef.current = Date.now()
      setPhase('recording')
    } catch (err) {
      if (abandoned()) return
      setError(err.message)
      setPhase('error')
    }
  }, [currentSubtest, createRecorder, playAudio, runCountdown, runTapSequence, abandonAttempt])

  const finishRecording = useCallback(async () => {
    // Capture the generation so a skip pressed during "Processing" retires this
    // continuation instead of racing skipSubtest to append a second result.
    const generation = generationRef.current
    const abandoned = () => generationRef.current !== generation
    setPhase('scoring')
    try {
      const blob = await recorderRef.current.stop()
      if (abandoned()) return
      const responseMs = Date.now() - recordingStartedAtRef.current
      const audioBuffer = await blob.arrayBuffer()
      const { text: transcript, engine } = await transcribeAudio(audioBuffer, blob.type, 'th')
      if (abandoned()) return
      const scoreResult = await scoreItem(currentSubtest.scorerId, transcript, {
        expectedSequence: currentSubtest.expectedSequence,
        referenceDate: new Date(),
        ...sessionContext
      })
      if (abandoned()) return

      // Debug aid for checking ASR accuracy against scoring during manual runs.
      // Silenced under Vitest so test output stays clean.
      if (import.meta.env.MODE !== 'test') {
        console.log(
          `[ASR] ${currentSubtest.id} (${engine})\n` +
            `  heard:    ${JSON.stringify(transcript)}\n` +
            `  expected: ${JSON.stringify(currentSubtest.expectedSequence ?? '(see scorer)')}\n` +
            `  score:    ${scoreResult.score}/${scoreResult.maxScore}\n` +
            `  response: ${(responseMs / 1000).toFixed(1)}s` +
            (currentSubtest.timeLimitSec ? ` (budget ${currentSubtest.timeLimitSec}s)` : ''),
          scoreResult
        )
      }

      completeSubtest(scoreResult, { transcript, engine, responseMs })
    } catch (err) {
      if (abandoned()) return
      setError(err.message)
      setPhase('error')
    }
  }, [currentSubtest, transcribeAudio, scoreItem, sessionContext, completeSubtest])

  // The drawing counterpart to finishRecording: called by the canvas component
  // with its captured drawing ({ strokes, image, jsonStr } for clock/cube, and
  // { strokes, analysis, image } for trail making). Scored on the main process
  // via the drawing scorers, which pass image/JSON on to the sidecar's
  // /clock and /cube endpoints (trail making is scored locally from analysis).
  const finishDrawing = useCallback(
    async (drawingData) => {
      const generation = generationRef.current
      const abandoned = () => generationRef.current !== generation
      setPhase('scoring')
      try {
        const responseMs = Date.now() - (recordingStartedAtRef.current || Date.now())
        const scoreResult = await scoreItem(currentSubtest.scorerId, '', {
          drawing: drawingData,
          referenceDate: new Date(),
          ...sessionContext
        })
        if (abandoned()) return

        if (import.meta.env.MODE !== 'test') {
          console.log(
            `[DRAW] ${currentSubtest.id}\n` +
              `  score:    ${scoreResult.score}/${scoreResult.maxScore}\n` +
              `  remarks:  ${scoreResult.remarks ?? '(none)'}\n` +
              `  response: ${(responseMs / 1000).toFixed(1)}s`,
            scoreResult
          )
        }

        completeSubtest(scoreResult, { transcript: '', engine: null, responseMs })
      } catch (err) {
        if (abandoned()) return
        setError(err.message)
        setPhase('error')
      }
    },
    [currentSubtest, scoreItem, sessionContext, completeSubtest]
  )

  // Verbal Fluency's real, normed 60-second deadline -- the one subtest in
  // the instrument where a slow patient is *supposed* to be cut off, unlike
  // every other subtest's timeLimitSec, which is a process-data budget only.
  // Runs the same path a manual Stop click does, so it scores exactly like
  // one. Cleanup fires whenever recording ends for any other reason (Stop
  // clicked, error, subtest advances), so it never double-fires.
  useEffect(() => {
    if (phase !== 'recording' || !currentSubtest.autoStopMs) return
    const timeoutId = setTimeout(finishRecording, currentSubtest.autoStopMs)
    return () => clearTimeout(timeoutId)
  }, [phase, currentSubtest, finishRecording])

  const retryRecording = useCallback(() => {
    abandonAttempt()
    setError(null)
    setPhase('instruction')
  }, [abandonAttempt])

  // A skipped subtest was never administered, so it scores nothing rather
  // than scoring 0 -- 0 would assert the patient failed. maxScore 0 keeps it
  // out of both sides of the total.
  const skipSubtest = useCallback(() => {
    abandonAttempt()
    setError(null)
    setResults((prev) => [
      ...prev,
      {
        subtestId: currentSubtest.id,
        skipped: true,
        score: 0,
        maxScore: 0,
        responseMs: null,
        timeLimitSec: currentSubtest.timeLimitSec || null,
        completedAt: Date.now()
      }
    ])
    if (index + 1 < subtests.length) {
      setIndex((prev) => prev + 1)
      setPhase('instruction')
    } else {
      setPhase('done')
    }
  }, [abandonAttempt, currentSubtest, index, subtests.length])

  // Back to the very first subtest with every result cleared, so the whole
  // battery can be re-administered without reloading the app.
  const resetSession = useCallback(() => {
    abandonAttempt()
    setResults([])
    setError(null)
    setCountdownValue(null)
    setIndex(0)
    setPhase('instruction')
  }, [abandonAttempt])

  // A no-op outside the tapping phase: a press during the lead-in or after
  // the last window is not an answer to any digit, so it must not become one.
  const recordTap = useCallback(() => {
    if (phase !== 'tapping') return
    tapsRef.current = [...tapsRef.current, Date.now() - sequenceStartedAtRef.current]
  }, [phase])

  return {
    currentSubtest,
    phase,
    results,
    error,
    countdownValue,
    index,
    total: subtests.length,
    isLastSubtest,
    beginSubtest,
    finishRecording,
    finishDrawing,
    retryRecording,
    skipSubtest,
    continueToNext,
    resetSession,
    recordTap
  }
}
