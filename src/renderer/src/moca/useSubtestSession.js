import { useState, useCallback, useRef } from 'react'

export function useSubtestSession(
  subtests,
  { transcribeAudio, scoreItem, createRecorder, playAudio, stopAudio },
  sessionContext = {}
) {
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState('instruction')
  const [results, setResults] = useState([])
  const [error, setError] = useState(null)
  const recorderRef = useRef(null)
  const generationRef = useRef(0)
  const recordingStartedAtRef = useRef(null)

  const currentSubtest = subtests[index]

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
  }, [currentSubtest, createRecorder, playAudio])

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

      setResults((prev) => [
        ...prev,
        // scoreResult spread first: the hook's own fields (subtestId,
        // transcript, engine, completedAt) are authoritative and must not be
        // overwritable by anything a scorer returns.
        {
          ...scoreResult,
          subtestId: currentSubtest.id,
          transcript,
          engine,
          responseMs,
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
    } catch (err) {
      setError(err.message)
      setPhase('error')
    }
  }, [currentSubtest, index, subtests.length, transcribeAudio, scoreItem, sessionContext])

  // Retire the in-flight attempt: bump the generation so its continuation
  // bails, and silence any file it left playing -- otherwise a skipped
  // stimulus keeps sounding over the next subtest.
  const abandonAttempt = useCallback(() => {
    generationRef.current += 1
    if (stopAudio) stopAudio()
  }, [stopAudio])

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

  return {
    currentSubtest,
    phase,
    results,
    error,
    beginSubtest,
    finishRecording,
    retryRecording,
    skipSubtest
  }
}
