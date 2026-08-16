import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSubtestSession } from './useSubtestSession.js'

const subtests = [
  { id: 'naming', scorerId: 'naming' },
  { id: 'orientation', scorerId: 'orientation' }
]

function setup() {
  const callOrder = []
  const fakeRecorder = {
    start: vi.fn().mockImplementation(async () => {
      callOrder.push('recorder.start')
    }),
    stop: vi.fn().mockResolvedValue(new Blob(['x']))
  }
  const createRecorder = vi.fn(() => fakeRecorder)
  const playAudio = vi.fn().mockImplementation(
    () =>
      new Promise((resolve) => {
        // Pushes on COMPLETION, not invocation. The recorder fake pushes on
        // invocation, so a missing `await` or a concurrent Promise.all would
        // log recorder.start first and fail this test.
        setTimeout(() => {
          callOrder.push('playAudio')
          resolve()
        }, 5)
      })
  )
  const transcribeAudio = vi.fn().mockResolvedValue({ text: 'สิงโต แรด อูฐ', engine: 'local' })
  const scoreItem = vi.fn().mockResolvedValue({ score: 3, maxScore: 3 })
  return { fakeRecorder, createRecorder, playAudio, transcribeAudio, scoreItem, callOrder }
}

describe('useSubtestSession', () => {
  it('starts on the first subtest in the instruction phase', () => {
    const deps = setup()
    const { result } = renderHook(() => useSubtestSession(subtests, deps))
    expect(result.current.currentSubtest.id).toBe('naming')
    expect(result.current.phase).toBe('instruction')
  })

  it('advances to the next subtest after recording and scoring finish', async () => {
    const deps = setup()
    const { result } = renderHook(() => useSubtestSession(subtests, deps))

    await act(async () => {
      await result.current.beginRecording()
    })
    expect(result.current.phase).toBe('recording')

    await act(async () => {
      await result.current.finishRecording()
    })

    expect(result.current.currentSubtest.id).toBe('orientation')
    expect(result.current.phase).toBe('instruction')
    expect(result.current.results).toHaveLength(1)
    expect(result.current.results[0]).toMatchObject({
      subtestId: 'naming',
      score: 3,
      maxScore: 3,
      engine: 'local'
    })
  })

  it('sets phase to done after the last subtest is scored', async () => {
    const deps = setup()
    const { result } = renderHook(() => useSubtestSession([subtests[1]], deps))

    await act(async () => {
      await result.current.beginRecording()
      await result.current.finishRecording()
    })

    expect(result.current.phase).toBe('done')
    expect(result.current.results).toHaveLength(1)
  })

  it('merges sessionContext (e.g. place/province) and a fresh referenceDate into the scoring context', async () => {
    const deps = setup()
    const sessionContext = { place: 'โรงพยาบาลตัวอย่าง', province: 'กรุงเทพ' }
    const { result } = renderHook(() => useSubtestSession([subtests[1]], deps, sessionContext))

    await act(async () => {
      await result.current.beginRecording()
      await result.current.finishRecording()
    })

    expect(deps.scoreItem).toHaveBeenCalledWith(
      'orientation',
      'สิงโต แรด อูฐ',
      expect.objectContaining({
        place: 'โรงพยาบาลตัวอย่าง',
        province: 'กรุงเทพ',
        referenceDate: expect.any(Date)
      })
    )
  })

  it('moves to the error phase and exposes the message when transcribeAudio rejects', async () => {
    const deps = setup()
    deps.transcribeAudio.mockRejectedValue(
      new Error('Transcription failed.\n  local:  boom\n  openai: cloud fallback disabled (MOCA_ALLOW_CLOUD_FALLBACK=false)')
    )
    const { result } = renderHook(() => useSubtestSession(subtests, deps))

    await act(async () => {
      await result.current.beginRecording()
    })

    await act(async () => {
      await result.current.finishRecording()
    })

    expect(result.current.phase).toBe('error')
    expect(result.current.error).toBe(
      'Transcription failed.\n  local:  boom\n  openai: cloud fallback disabled (MOCA_ALLOW_CLOUD_FALLBACK=false)'
    )
    expect(result.current.results).toHaveLength(0)
    expect(result.current.currentSubtest.id).toBe('naming')
  })

  it('retryRecording clears the error and returns to instruction on the same subtest without altering results', async () => {
    const deps = setup()
    deps.transcribeAudio.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useSubtestSession(subtests, deps))

    await act(async () => {
      await result.current.beginRecording()
    })
    await act(async () => {
      await result.current.finishRecording()
    })
    expect(result.current.phase).toBe('error')

    act(() => {
      result.current.retryRecording()
    })

    expect(result.current.phase).toBe('instruction')
    expect(result.current.error).toBeNull()
    expect(result.current.currentSubtest.id).toBe('naming')
    expect(result.current.results).toHaveLength(0)
  })
})

describe('useSubtestSession stimulus playback', () => {
  const withAudio = [{ id: 'digit-span-forward', scorerId: 'digit-span-forward', audio: 'digits.mp3' }]
  const withoutAudio = [{ id: 'orientation', scorerId: 'orientation' }]

  it('plays the stimulus to completion BEFORE opening the microphone', async () => {
    const deps = setup()
    const { result } = renderHook(() => useSubtestSession(withAudio, deps))

    await act(async () => {
      await result.current.beginRecording()
    })

    expect(deps.playAudio).toHaveBeenCalledWith('digits.mp3')
    // The guarantee: if these ever invert, the mic records the prompt and the
    // ASR transcribes the app's own voice.
    expect(deps.callOrder).toEqual(['playAudio', 'recorder.start'])
    expect(result.current.phase).toBe('recording')
  })

  it('skips playback entirely for subtests with no audio', async () => {
    const deps = setup()
    const { result } = renderHook(() => useSubtestSession(withoutAudio, deps))

    await act(async () => {
      await result.current.beginRecording()
    })

    expect(deps.playAudio).not.toHaveBeenCalled()
    expect(result.current.phase).toBe('recording')
  })

  it('routes a playback failure to the error phase rather than recording anyway', async () => {
    const deps = setup()
    deps.playAudio.mockRejectedValue(new Error('Failed to play stimulus audio: digits.mp3'))
    const { result } = renderHook(() => useSubtestSession(withAudio, deps))

    await act(async () => {
      await result.current.beginRecording()
    })

    expect(result.current.phase).toBe('error')
    expect(result.current.error).toContain('Failed to play stimulus audio')
    expect(deps.fakeRecorder.start).not.toHaveBeenCalled()
  })

  it('stamps each result with the time it completed', async () => {
    const deps = setup()
    const { result } = renderHook(() => useSubtestSession(withoutAudio, deps))
    const before = Date.now()

    await act(async () => {
      await result.current.beginRecording()
      await result.current.finishRecording()
    })

    const { completedAt } = result.current.results[0]
    expect(typeof completedAt).toBe('number')
    expect(completedAt).toBeGreaterThanOrEqual(before)
  })
})

describe('useSubtestSession skipping', () => {
  const twoSubtests = [
    { id: 'digit-span-forward', scorerId: 'digit-span-forward', audio: 'digits.mp3' },
    { id: 'orientation', scorerId: 'orientation' }
  ]

  it('records the subtest as skipped and advances past it', async () => {
    const deps = setup()
    deps.playAudio.mockRejectedValue(new Error('Failed to play stimulus audio: digits.mp3'))
    const { result } = renderHook(() => useSubtestSession(twoSubtests, deps))

    await act(async () => {
      await result.current.beginRecording()
    })
    expect(result.current.phase).toBe('error')

    act(() => {
      result.current.skipSubtest()
    })

    expect(result.current.currentSubtest.id).toBe('orientation')
    expect(result.current.phase).toBe('instruction')
    expect(result.current.error).toBeNull()
    expect(result.current.results).toHaveLength(1)
    expect(result.current.results[0]).toMatchObject({
      subtestId: 'digit-span-forward',
      skipped: true,
      score: 0,
      maxScore: 0
    })
  })

  it('finishes the session when the last subtest is skipped', async () => {
    const deps = setup()
    const { result } = renderHook(() => useSubtestSession([twoSubtests[1]], deps))

    act(() => {
      result.current.skipSubtest()
    })

    expect(result.current.phase).toBe('done')
    expect(result.current.results).toHaveLength(1)
  })

  it('stamps a skipped result with completedAt like any other result', async () => {
    const deps = setup()
    const before = Date.now()
    const { result } = renderHook(() => useSubtestSession(twoSubtests, deps))

    act(() => {
      result.current.skipSubtest()
    })

    expect(result.current.results[0].completedAt).toBeGreaterThanOrEqual(before)
  })
})

describe('useSubtestSession instruction audio', () => {
  const both = [
    {
      id: 'digit-span-forward',
      scorerId: 'digit-span-forward',
      instructionAudio: 'instr.mp3',
      audio: 'digits.mp3'
    }
  ]
  const instructionOnly = [
    { id: 'naming', scorerId: 'naming', instructionAudio: 'instr-naming.mp3' }
  ]

  it('plays the instruction before the stimulus, and both before the microphone', async () => {
    const deps = setup()
    const { result } = renderHook(() => useSubtestSession(both, deps))

    await act(async () => {
      await result.current.beginRecording()
    })

    // A clinician reads the instruction, then presents the stimulus, then
    // listens. Any other order changes what the subtest measures.
    expect(deps.playAudio.mock.calls.map((c) => c[0])).toEqual(['instr.mp3', 'digits.mp3'])
    expect(deps.callOrder).toEqual(['playAudio', 'playAudio', 'recorder.start'])
    expect(result.current.phase).toBe('recording')
  })

  it('plays an instruction for a subtest that has no stimulus', async () => {
    const deps = setup()
    const { result } = renderHook(() => useSubtestSession(instructionOnly, deps))

    await act(async () => {
      await result.current.beginRecording()
    })

    expect(deps.playAudio).toHaveBeenCalledTimes(1)
    expect(deps.playAudio).toHaveBeenCalledWith('instr-naming.mp3')
    expect(deps.callOrder).toEqual(['playAudio', 'recorder.start'])
  })

  it('routes a failed instruction to the error phase without playing the stimulus', async () => {
    const deps = setup()
    deps.playAudio.mockRejectedValueOnce(new Error('Failed to play stimulus audio: instr.mp3'))
    const { result } = renderHook(() => useSubtestSession(both, deps))

    await act(async () => {
      await result.current.beginRecording()
    })

    expect(result.current.phase).toBe('error')
    expect(deps.playAudio).toHaveBeenCalledTimes(1)
    expect(deps.fakeRecorder.start).not.toHaveBeenCalled()
  })
})

describe('useSubtestSession abandoned playback', () => {
  const twoSubtests = [
    { id: 'delayed-recall', scorerId: 'delayed-recall', instructionAudio: 'instr.mp3' },
    { id: 'orientation', scorerId: 'orientation', instructionAudio: 'instr-orientation.mp3' }
  ]

  it('does not let a skipped subtest\'s playback open the mic on the NEXT subtest', async () => {
    const deps = setup()
    // A stimulus we control, so we can skip while it is still playing.
    let releaseAudio
    deps.playAudio.mockImplementation(
      () => new Promise((resolve) => { releaseAudio = resolve })
    )

    const { result } = renderHook(() => useSubtestSession(twoSubtests, deps))

    // Start the first subtest; beginRecording suspends awaiting the audio.
    let pending
    await act(async () => {
      pending = result.current.beginRecording()
      await Promise.resolve()
    })
    expect(result.current.phase).toBe('stimulus')

    // Operator skips while the audio is still playing.
    act(() => {
      result.current.skipSubtest()
    })
    expect(result.current.currentSubtest.id).toBe('orientation')
    expect(result.current.phase).toBe('instruction')

    // The abandoned audio now finishes. Its continuation must NOT resume and
    // open the microphone -- it belongs to a subtest the operator abandoned.
    await act(async () => {
      releaseAudio()
      await pending
    })

    expect(deps.fakeRecorder.start).not.toHaveBeenCalled()
    expect(result.current.phase).toBe('instruction')
    expect(result.current.currentSubtest.id).toBe('orientation')
  })
})
