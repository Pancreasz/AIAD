import { useState, useCallback, useRef } from 'react'

export function useSubtestSession(
  subtests,
  { transcribeAudio, scoreItem, createRecorder },
  sessionContext = {}
) {
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState('instruction')
  const [results, setResults] = useState([])
  const recorderRef = useRef(null)

  const currentSubtest = subtests[index]

  const beginRecording = useCallback(async () => {
    recorderRef.current = createRecorder()
    await recorderRef.current.start()
    setPhase('recording')
  }, [createRecorder])

  const finishRecording = useCallback(async () => {
    setPhase('scoring')
    const blob = await recorderRef.current.stop()
    const audioBuffer = await blob.arrayBuffer()
    const { text: transcript, engine } = await transcribeAudio(audioBuffer, blob.type, 'th')
    const scoreResult = await scoreItem(currentSubtest.scorerId, transcript, {
      expectedSequence: currentSubtest.expectedSequence,
      referenceDate: new Date(),
      ...sessionContext
    })

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
  }, [currentSubtest, index, subtests.length, transcribeAudio, scoreItem, sessionContext])

  return { currentSubtest, phase, results, beginRecording, finishRecording }
}
