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
      await result.current.beginSubtest()
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
      await result.current.beginSubtest()
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
      await result.current.beginSubtest()
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
      await result.current.beginSubtest()
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
      await result.current.beginSubtest()
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
      await result.current.beginSubtest()
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
      await result.current.beginSubtest()
    })

    expect(deps.playAudio).not.toHaveBeenCalled()
    expect(result.current.phase).toBe('recording')
  })

  it('routes a playback failure to the error phase rather than recording anyway', async () => {
    const deps = setup()
    deps.playAudio.mockRejectedValue(new Error('Failed to play stimulus audio: digits.mp3'))
    const { result } = renderHook(() => useSubtestSession(withAudio, deps))

    await act(async () => {
      await result.current.beginSubtest()
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
      await result.current.beginSubtest()
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
      await result.current.beginSubtest()
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
      await result.current.beginSubtest()
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
      await result.current.beginSubtest()
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
      await result.current.beginSubtest()
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

    // Start the first subtest; beginSubtest suspends awaiting the audio.
    let pending
    await act(async () => {
      pending = result.current.beginSubtest()
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

describe('useSubtestSession stops abandoned audio', () => {
  const twoSubtests = [
    { id: 'delayed-recall', scorerId: 'delayed-recall', instructionAudio: 'instr.mp3' },
    { id: 'orientation', scorerId: 'orientation' }
  ]

  it('stops in-flight playback when the operator skips', async () => {
    const deps = setup()
    deps.stopAudio = vi.fn()
    deps.playAudio.mockImplementation(() => new Promise(() => {}))
    const { result } = renderHook(() => useSubtestSession(twoSubtests, deps))

    await act(async () => {
      result.current.beginSubtest()
      await Promise.resolve()
    })

    act(() => {
      result.current.skipSubtest()
    })

    // Without this the file keeps playing audibly over the next subtest.
    expect(deps.stopAudio).toHaveBeenCalled()
  })

  it('stops in-flight playback when the operator retries', async () => {
    const deps = setup()
    deps.stopAudio = vi.fn()
    deps.playAudio.mockImplementation(() => new Promise(() => {}))
    const { result } = renderHook(() => useSubtestSession(twoSubtests, deps))

    await act(async () => {
      result.current.beginSubtest()
      await Promise.resolve()
    })

    act(() => {
      result.current.retryRecording()
    })

    expect(deps.stopAudio).toHaveBeenCalled()
  })

  it('works when no stopAudio dependency is supplied', async () => {
    const deps = setup()
    const { result } = renderHook(() => useSubtestSession(twoSubtests, deps))
    expect(() => act(() => result.current.skipSubtest())).not.toThrow()
  })
})

describe('useSubtestSession response timing', () => {
  const timed = [{ id: 'digit-span-forward', scorerId: 'digit-span-forward', timeLimitSec: 7 }]
  const untimed = [{ id: 'orientation', scorerId: 'orientation' }]

  it('records how long the microphone was open, and the budget to compare it against', async () => {
    const deps = setup()
    const { result } = renderHook(() => useSubtestSession(timed, deps))

    await act(async () => {
      await result.current.beginSubtest()
      await result.current.finishRecording()
    })

    const entry = result.current.results[0]
    expect(typeof entry.responseMs).toBe('number')
    expect(entry.responseMs).toBeGreaterThanOrEqual(0)
    expect(entry.timeLimitSec).toBe(7)
  })

  it('reports a null budget for a subtest that declares none', async () => {
    const deps = setup()
    const { result } = renderHook(() => useSubtestSession(untimed, deps))

    await act(async () => {
      await result.current.beginSubtest()
      await result.current.finishRecording()
    })

    expect(result.current.results[0].timeLimitSec).toBeNull()
    expect(typeof result.current.results[0].responseMs).toBe('number')
  })

  it('reports null response time for a skipped subtest rather than zero', async () => {
    // Zero would read as "answered instantly". The subtest never ran.
    const deps = setup()
    const { result } = renderHook(() => useSubtestSession(timed, deps))

    act(() => {
      result.current.skipSubtest()
    })

    expect(result.current.results[0].responseMs).toBeNull()
  })

  it('measures the mic-open window, not the time spent playing the stimulus', async () => {
    const deps = setup()
    const withAudio = [
      { id: 'digit-span-forward', scorerId: 'digit-span-forward', audio: 'd.mp3', timeLimitSec: 7 }
    ]
    // setup()'s playAudio takes 5ms; that must not be counted as response time.
    const { result } = renderHook(() => useSubtestSession(withAudio, deps))

    await act(async () => {
      await result.current.beginSubtest()
      await result.current.finishRecording()
    })

    expect(result.current.results[0].responseMs).toBeLessThan(5)
  })
})

describe('useSubtestSession auto-stop', () => {
  // Verbal Fluency's real 60s deadline. Using a tiny ms value here so the
  // test runs fast; the mechanism doesn't care about the magnitude.
  const withAutoStop = [{ id: 'verbal-fluency', scorerId: 'verbal-fluency', autoStopMs: 10 }]
  const withoutAutoStop = [{ id: 'orientation', scorerId: 'orientation' }]

  it('stops and scores automatically once autoStopMs elapses, without a manual Stop click', async () => {
    const deps = setup()
    const { result } = renderHook(() => useSubtestSession(withAutoStop, deps))

    await act(async () => {
      await result.current.beginSubtest()
    })
    expect(result.current.phase).toBe('recording')

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40))
    })

    expect(deps.fakeRecorder.stop).toHaveBeenCalled()
    expect(result.current.phase).toBe('done')
    expect(result.current.results).toHaveLength(1)
  })

  it('does not schedule an auto-stop for a subtest that declares none', async () => {
    const deps = setup()
    const { result } = renderHook(() => useSubtestSession(withoutAutoStop, deps))

    await act(async () => {
      await result.current.beginSubtest()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40))
    })

    expect(result.current.phase).toBe('recording')
  })

  it('does not double-score when the manual Stop click already finished recording', async () => {
    const deps = setup()
    const { result } = renderHook(() => useSubtestSession(withAutoStop, deps))

    await act(async () => {
      await result.current.beginSubtest()
    })
    await act(async () => {
      await result.current.finishRecording()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40))
    })

    expect(result.current.results).toHaveLength(1)
  })
})

const tapSubtest = {
  id: 'vigilance',
  scorerId: 'vigilance',
  responseMode: 'tap',
  sequence: '51319',
  target: '1',
  intervalMs: 1000,
  leadInMs: 1000,
  instructionAudio: 'moca/audio/instr-vigilance.mp3'
}

function setupTap() {
  const base = setup()
  // The shared setup() resolves playAudio on a 5ms timer, to prove ordering in
  // the voice tests. Here that timer would race every `await act(...)`, so the
  // tap tests resolve instruction audio on a microtask instead and leave the
  // ordering guarantee to the test that exists for it.
  base.playAudio = vi.fn().mockResolvedValue(undefined)
  let releaseSequence
  let startSequence
  const preloadDigits = vi.fn().mockResolvedValue(undefined)
  const playDigitSequence = vi.fn().mockImplementation((sequence, { onStart }) => {
    // Hands the test the two moments that matter: when the first digit sounds
    // (taps start counting) and when the last window closes (scoring runs).
    startSequence = onStart
    return new Promise((resolve) => {
      releaseSequence = resolve
    })
  })
  const stopDigitSequence = vi.fn()
  return {
    ...base,
    preloadDigits,
    playDigitSequence,
    stopDigitSequence,
    startSequence: () => startSequence(),
    releaseSequence: () => releaseSequence()
  }
}

describe('useSubtestSession in tap mode', () => {
  // The tap-mode sibling of the "mic never opens before playback finishes"
  // guarantee. A recorder left open through 29 seconds of the app's own voice
  // is a live microphone nobody closes.
  it('never creates a recorder', async () => {
    const deps = setupTap()
    const { result } = renderHook(() => useSubtestSession([tapSubtest], deps))

    await act(async () => {
      result.current.beginSubtest()
    })
    await act(async () => {
      deps.startSequence()
    })
    await act(async () => {
      deps.releaseSequence()
    })

    expect(deps.createRecorder).not.toHaveBeenCalled()
    expect(deps.transcribeAudio).not.toHaveBeenCalled()
  })

  it('preloads only the distinct digits the sequence actually uses', async () => {
    const deps = setupTap()
    const { result } = renderHook(() => useSubtestSession([tapSubtest], deps))

    await act(async () => {
      result.current.beginSubtest()
    })

    expect(deps.preloadDigits).toHaveBeenCalledWith(['5', '1', '3', '9'])
  })

  it('enters the tapping phase when the first digit sounds, not when Start is pressed', async () => {
    const deps = setupTap()
    const { result } = renderHook(() => useSubtestSession([tapSubtest], deps))

    await act(async () => {
      result.current.beginSubtest()
    })
    expect(result.current.phase).toBe('stimulus')

    await act(async () => {
      deps.startSequence()
    })
    expect(result.current.phase).toBe('tapping')
  })

  it('measures taps from the first digit onset and scores them', async () => {
    const deps = setupTap()
    const { result } = renderHook(() => useSubtestSession([tapSubtest], deps))
    const nowSpy = vi.spyOn(Date, 'now')

    await act(async () => {
      result.current.beginSubtest()
    })

    nowSpy.mockReturnValue(10_000)
    await act(async () => {
      deps.startSequence()
    })

    nowSpy.mockReturnValue(11_400)
    act(() => {
      result.current.recordTap()
    })
    nowSpy.mockReturnValue(13_500)
    act(() => {
      result.current.recordTap()
    })

    nowSpy.mockRestore()
    await act(async () => {
      deps.releaseSequence()
    })

    expect(deps.scoreItem).toHaveBeenCalledWith(
      'vigilance',
      '',
      expect.objectContaining({
        taps: [1400, 3500],
        sequence: '51319',
        target: '1',
        intervalMs: 1000
      })
    )
  })

  it('ignores taps outside the tapping phase', async () => {
    const deps = setupTap()
    const { result } = renderHook(() => useSubtestSession([tapSubtest], deps))

    act(() => {
      result.current.recordTap()
    })
    await act(async () => {
      result.current.beginSubtest()
    })
    act(() => {
      result.current.recordTap()
    })
    await act(async () => {
      deps.startSequence()
    })
    await act(async () => {
      deps.releaseSequence()
    })

    expect(deps.scoreItem).toHaveBeenCalledWith('vigilance', '', expect.objectContaining({ taps: [] }))
  })

  it('records the result with no transcript and no engine', async () => {
    const deps = setupTap()
    deps.scoreItem.mockResolvedValue({ score: 1, maxScore: 1, hits: 11, misses: 0, falseTaps: 0 })
    const { result } = renderHook(() => useSubtestSession([tapSubtest], deps))

    await act(async () => {
      result.current.beginSubtest()
    })
    await act(async () => {
      deps.startSequence()
    })
    await act(async () => {
      deps.releaseSequence()
    })

    expect(result.current.phase).toBe('done')
    expect(result.current.results[0]).toMatchObject({
      subtestId: 'vigilance',
      score: 1,
      maxScore: 1,
      transcript: '',
      engine: null
    })
  })

  it('cancels the sequence when the subtest is skipped mid-run', async () => {
    const deps = setupTap()
    const { result } = renderHook(() => useSubtestSession([tapSubtest], deps))

    await act(async () => {
      result.current.beginSubtest()
    })
    await act(async () => {
      deps.startSequence()
    })
    act(() => {
      result.current.skipSubtest()
    })

    expect(deps.stopDigitSequence).toHaveBeenCalled()
    expect(result.current.results[0]).toMatchObject({ subtestId: 'vigilance', skipped: true })
  })

  it('does not score an abandoned tap sequence when it finishes after a skip', async () => {
    const deps = setupTap()
    const { result } = renderHook(() => useSubtestSession([tapSubtest], deps))

    await act(async () => {
      result.current.beginSubtest()
    })
    await act(async () => {
      deps.startSequence()
    })
    act(() => {
      result.current.skipSubtest()
    })

    // stopDigitSequence leaves play()'s promise unsettled by design, so the
    // real player would never resolve here -- but the generation guard is what
    // must retire the continuation, and it has to hold even if it does.
    await act(async () => {
      deps.releaseSequence()
    })

    expect(deps.scoreItem).not.toHaveBeenCalled()
    expect(result.current.results).toHaveLength(1)
    expect(result.current.results[0]).toMatchObject({ subtestId: 'vigilance', skipped: true })
  })

  it('routes a preload failure to the error phase rather than a silent skip', async () => {
    const deps = setupTap()
    deps.preloadDigits.mockRejectedValue(new Error('Failed to load digit audio: moca/audio/digit-3.mp3'))
    const { result } = renderHook(() => useSubtestSession([tapSubtest], deps))

    await act(async () => {
      result.current.beginSubtest()
    })

    expect(result.current.phase).toBe('error')
    expect(result.current.error).toContain('digit-3.mp3')
  })
})
