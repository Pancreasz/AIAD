import { useState, useCallback, useRef } from 'react'

export function useSubtestSession(
  subtests,
  { transcribeAudio, scoreItem, createRecorder, playAudio },
  sessionContext = {}
) {
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState('instruction')
  const [results, setResults] = useState([])
  const [error, setError] = useState(null)
  const recorderRef = useRef(null)

  const currentSubtest = subtests[index]

  const beginRecording = useCallback(async () => {
    try {
      // The mic must not open until the stimulus has finished. If these
      // overlap, the recording captures the prompt and the ASR transcribes
      // the app's own voice -- the subtest would appear to pass while
      // measuring nothing.
      if (currentSubtest.audio) {
        setPhase('stimulus')
        await playAudio(currentSubtest.audio)
      }
      recorderRef.current = createRecorder()
      await recorderRef.current.start()
      setPhase('recording')
    } catch (err) {
      setError(err.message)
      setPhase('error')
    }
  }, [currentSubtest, createRecorder, playAudio])

  const finishRecording = useCallback(async () => {
    setPhase('scoring')
    try {
      const blob = await recorderRef.current.stop()
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
            `  score:    ${scoreResult.score}/${scoreResult.maxScore}`,
          scoreResult
        )
      }

      setResults((prev) => [
        ...prev,
        // scoreResult spread first: the hook's own fields (subtestId,
        // transcript, engine, completedAt) are authoritative and must not be
        // overwritable by anything a scorer returns.
        { ...scoreResult, subtestId: currentSubtest.id, transcript, engine, completedAt: Date.now() }
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

  const retryRecording = useCallback(() => {
    setError(null)
    setPhase('instruction')
  }, [])

  // A skipped subtest was never administered, so it scores nothing rather
  // than scoring 0 -- 0 would assert the patient failed. maxScore 0 keeps it
  // out of both sides of the total.
  const skipSubtest = useCallback(() => {
    setError(null)
    setResults((prev) => [
      ...prev,
      {
        subtestId: currentSubtest.id,
        skipped: true,
        score: 0,
        maxScore: 0,
        completedAt: Date.now()
      }
    ])
    if (index + 1 < subtests.length) {
      setIndex((prev) => prev + 1)
      setPhase('instruction')
    } else {
      setPhase('done')
    }
  }, [currentSubtest, index, subtests.length])

  return {
    currentSubtest,
    phase,
    results,
    error,
    beginRecording,
    finishRecording,
    retryRecording,
    skipSubtest
  }
}
