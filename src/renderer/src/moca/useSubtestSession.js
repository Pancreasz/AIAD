import { useState, useCallback, useRef } from 'react'

export function useSubtestSession(
  subtests,
  { transcribeAudio, scoreItem, createRecorder },
  sessionContext = {}
) {
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState('instruction')
  const [results, setResults] = useState([])
  const [error, setError] = useState(null)
  const recorderRef = useRef(null)

  const currentSubtest = subtests[index]

  const beginRecording = useCallback(async () => {
    recorderRef.current = createRecorder()
    await recorderRef.current.start()
    setPhase('recording')
  }, [createRecorder])

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
        { subtestId: currentSubtest.id, transcript, engine, ...scoreResult }
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

  return {
    currentSubtest,
    phase,
    results,
    error,
    beginRecording,
    finishRecording,
    retryRecording
  }
}
