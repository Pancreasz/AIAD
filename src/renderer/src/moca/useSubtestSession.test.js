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
  const playAudio = vi.fn().mockImplementation(async () => {
    callOrder.push('playAudio')
  })
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
