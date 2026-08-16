import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDigitSequencePlayer } from './DigitSequencePlayer.js'

// A fake HTMLAudioElement: records every play() with the fake clock's time, so
// tests assert onsets rather than waiting 29 real seconds.
function makeAudioClass(log, { failSrc } = {}) {
  return class FakeAudio {
    constructor(src) {
      this.src = src
      this.currentTime = 0
      this.paused = false
      // Load outcome is delivered asynchronously, as a real element does.
      setTimeout(() => {
        if (src === failSrc) this.onerror?.()
        else this.oncanplaythrough?.()
      }, 0)
    }
    load() {}
    play() {
      log.push({ src: this.src, at: Date.now(), currentTime: this.currentTime })
      // A real element is left at the end of its buffer once it has played.
      // Without this the assertion below cannot fail: currentTime would read 0
      // on every entry even if the player never rewound at all.
      this.currentTime = 0.42
      return Promise.resolve()
    }
    pause() {
      this.paused = true
    }
  }
}

function setup({ failSrc } = {}) {
  const log = []
  const player = createDigitSequencePlayer({
    audioClass: makeAudioClass(log, { failSrc }),
    now: () => Date.now(),
    setTimer: setTimeout,
    clearTimer: clearTimeout
  })
  return { player, log }
}

describe('createDigitSequencePlayer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves preload once every digit file can play through', async () => {
    const { player } = setup()
    const loaded = player.preload(['1', '5'])
    await vi.advanceTimersByTimeAsync(1)
    await expect(loaded).resolves.toBeUndefined()
  })

  it('rejects preload naming the file that failed', async () => {
    const { player } = setup({ failSrc: 'moca/audio/digit-5.mp3' })
    // The assertion must subscribe BEFORE the timers run, or the rejection
    // fires with no handler attached and vitest exits 1 on an unhandled
    // rejection while every assertion still passes.
    const assertion = expect(player.preload(['1', '5'])).rejects.toThrow('moca/audio/digit-5.mp3')
    await vi.advanceTimersByTimeAsync(1)
    await assertion
  })

  it('plays each digit at its scheduled onset with no accumulated drift', async () => {
    const { player, log } = setup()
    const loaded = player.preload(['1', '5', '9'])
    await vi.advanceTimersByTimeAsync(1)
    await loaded

    const start = Date.now()
    player.play('595191', { intervalMs: 1000, leadInMs: 1000 })
    await vi.advanceTimersByTimeAsync(1000 + 6 * 1000)

    const offsets = log.map((entry) => entry.at - start)
    // Lead-in, then one per second. The last digit is the sixth, at 6000ms.
    expect(offsets).toEqual([1000, 2000, 3000, 4000, 5000, 6000])
  })

  it('plays the file matching each digit, in sequence order', async () => {
    const { player, log } = setup()
    const loaded = player.preload(['1', '9'])
    await vi.advanceTimersByTimeAsync(1)
    await loaded

    player.play('191', { intervalMs: 1000, leadInMs: 0 })
    await vi.advanceTimersByTimeAsync(3000)

    expect(log.map((entry) => entry.src)).toEqual([
      'moca/audio/digit-1.mp3',
      'moca/audio/digit-9.mp3',
      'moca/audio/digit-1.mp3'
    ])
  })

  // The digit 1 plays eleven times in the real sequence, three of them back to
  // back. Without a rewind the element is already at its end and stays silent.
  it('rewinds a repeated digit before replaying it', async () => {
    const { player, log } = setup()
    const loaded = player.preload(['1'])
    await vi.advanceTimersByTimeAsync(1)
    await loaded

    player.play('111', { intervalMs: 1000, leadInMs: 0 })
    await vi.advanceTimersByTimeAsync(3000)

    expect(log).toHaveLength(3)
    expect(log.every((entry) => entry.currentTime === 0)).toBe(true)
  })

  it('calls onStart when the first digit plays, not when play is called', async () => {
    const { player } = setup()
    const loaded = player.preload(['1'])
    await vi.advanceTimersByTimeAsync(1)
    await loaded

    const onStart = vi.fn()
    player.play('11', { intervalMs: 1000, leadInMs: 1000, onStart })
    expect(onStart).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    expect(onStart).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('resolves only after the final window closes', async () => {
    const { player } = setup()
    const loaded = player.preload(['1'])
    await vi.advanceTimersByTimeAsync(1)
    await loaded

    const settled = vi.fn()
    player.play('11', { intervalMs: 1000, leadInMs: 1000 }).then(settled)

    // Last digit has sounded, but its window is still open.
    await vi.advanceTimersByTimeAsync(1000 + 1000)
    expect(settled).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    expect(settled).toHaveBeenCalled()
  })

  // Same bug class stopAudio() was added for: a skipped subtest that keeps
  // speaking over the next one. Here it would be 29 of them.
  it('stops playing further digits after stop()', async () => {
    const { player, log } = setup()
    const loaded = player.preload(['1'])
    await vi.advanceTimersByTimeAsync(1)
    await loaded

    player.play('1111', { intervalMs: 1000, leadInMs: 0 })
    // Mid-way between the second and third digits. Advancing to exactly 2000
    // would fire the third as well -- fake timers run a timer scheduled on the
    // boundary -- which is a property of the clock, not of stop().
    await vi.advanceTimersByTimeAsync(1500)
    expect(log).toHaveLength(2)

    player.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(log).toHaveLength(2)
  })

  it('leaves the play promise unsettled after stop(), so the caller is retired by the hook rather than resumed', async () => {
    const { player } = setup()
    const loaded = player.preload(['1'])
    await vi.advanceTimersByTimeAsync(1)
    await loaded

    const settled = vi.fn()
    player.play('11', { intervalMs: 1000, leadInMs: 0 }).then(settled)
    await vi.advanceTimersByTimeAsync(500)
    player.stop()
    await vi.advanceTimersByTimeAsync(10000)

    expect(settled).not.toHaveBeenCalled()
  })
})
