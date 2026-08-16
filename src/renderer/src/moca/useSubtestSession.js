import { useState, useCallback, useRef } from 'react'

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
    stopDigitSequence
  },
  sessionContext = {}
) {
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState('instruction')
  const [results, setResults] = useState([])
  const [error, setError] = useState(null)
  const recorderRef = useRef(null)
  const generationRef = useRef(0)
  const recordingStartedAtRef = useRef(null)
  const tapsRef = useRef([])
  const sequenceStartedAtRef = useRef(null)

  const currentSubtest = subtests[index]

  // Both modalities end the same way: append a result, then advance or finish.
  // The hook's own fields are written after the scorer's spread so a scorer
  // can never overwrite subtestId, transcript, or engine.
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
      if (index + 1 < subtests.length) {
        setIndex((prev) => prev + 1)
        setPhase('instruction')
      } else {
        setPhase('done')
      }
    },
    [currentSubtest, index, subtests.length]
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

      completeSubtest(scoreResult, {
        transcript: '',
        // No ASR ran. SessionResults already renders `engine ?? '—'`.
        engine: null,
        responseMs
      })
    },
    [currentSubtest, preloadDigits, playDigitSequence, scoreItem, sessionContext, completeSubtest]
  )

  const beginSubtest = useCallback(async () => {
    // Each attempt claims a generation. Anything that abandons the current
    // subtest -- Skip, Retry, or a second Start -- bumps it, so a continuation
    // suspended on `await playAudio(...)` bails instead of resuming against
    // whatever subtest is current by then. Without this, skipping during
    // playback let the abandoned attempt open the microphone on the NEXT
    // subtest seconds later. Same pattern as sidecarProcess.js.
    const generation = (generationRef.current += 1)
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

      if (currentSubtest.responseMode === 'tap') {
        await runTapSequence(abandoned)
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
  }, [currentSubtest, createRecorder, playAudio, runTapSequence])

  const finishRecording = useCallback(async () => {
    setPhase('scoring')
    try {
      const blob = await recorderRef.current.stop()
      const responseMs = Date.now() - recordingStartedAtRef.current
      const audioBuffer = await blob.arrayBuffer()
      const { text: transcript, engine } = await transcribeAudio(audioBuffer, blob.type, 'th')
      const scoreResult = await scoreItem(currentSubtest.scorerId, transcript, {
        expectedSequence: currentSubtest.expectedSequence,
        referenceDate: new Date(),
        ...sessionContext
      })

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
      setError(err.message)
      setPhase('error')
    }
  }, [currentSubtest, transcribeAudio, scoreItem, sessionContext, completeSubtest])

  // Retire the in-flight attempt: bump the generation so its continuation
  // bails, and silence any file it left playing -- otherwise a skipped
  // stimulus keeps sounding over the next subtest.
  const abandonAttempt = useCallback(() => {
    generationRef.current += 1
    if (stopAudio) stopAudio()
    if (stopDigitSequence) stopDigitSequence()
  }, [stopAudio, stopDigitSequence])

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
    beginSubtest,
    finishRecording,
    retryRecording,
    skipSubtest,
    recordTap
  }
}
