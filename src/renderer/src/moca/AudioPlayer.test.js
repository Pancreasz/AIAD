import { describe, it, expect, vi } from 'vitest'
import { createAudioPlayer } from './AudioPlayer.js'

class FakeAudio {
  constructor(src) {
    this.src = src
    FakeAudio.last = this
  }
  play() {
    return Promise.resolve()
  }
}

describe('createAudioPlayer', () => {
  it('resolves when the audio finishes playing', async () => {
    const player = createAudioPlayer({ audioClass: FakeAudio })
    const pending = player.play('memory-words.mp3')

    expect(FakeAudio.last.src).toBe('memory-words.mp3')
    FakeAudio.last.onended()

    await expect(pending).resolves.toBeUndefined()
  })

  it('does not resolve before the audio has ended', async () => {
    const player = createAudioPlayer({ audioClass: FakeAudio })
    const settled = vi.fn()
    player.play('memory-words.mp3').then(settled)

    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
  })

  it('rejects with a descriptive error when playback errors', async () => {
    const player = createAudioPlayer({ audioClass: FakeAudio })
    const pending = player.play('missing.mp3')

    FakeAudio.last.onerror()

    await expect(pending).rejects.toThrow('Failed to play stimulus audio: missing.mp3')
  })

  it('rejects when the browser refuses to start playback', async () => {
    class BlockedAudio extends FakeAudio {
      play() {
        return Promise.reject(new Error('NotAllowedError'))
      }
    }
    const player = createAudioPlayer({ audioClass: BlockedAudio })

    await expect(player.play('blocked.mp3')).rejects.toThrow('NotAllowedError')
  })
})

describe('createAudioPlayer stop', () => {
  class PausableAudio {
    constructor(src) {
      this.src = src
      this.currentTime = 0
      this.paused = false
      PausableAudio.last = this
    }
    play() {
      return Promise.resolve()
    }
    pause() {
      this.paused = true
    }
  }

  it('pauses the audio that is currently playing', async () => {
    const player = createAudioPlayer({ audioClass: PausableAudio })
    player.play('long.mp3')

    player.stop()

    expect(PausableAudio.last.paused).toBe(true)
  })

  it('leaves a stopped playback promise unsettled rather than resolving it', async () => {
    // A stopped stimulus was abandoned, not completed. Resolving would let the
    // caller continue as though the audio had finished playing.
    const player = createAudioPlayer({ audioClass: PausableAudio })
    const settled = vi.fn()
    player.play('long.mp3').then(settled, settled)

    player.stop()
    await Promise.resolve()
    await Promise.resolve()

    expect(settled).not.toHaveBeenCalled()
  })

  it('is safe to call when nothing is playing', () => {
    const player = createAudioPlayer({ audioClass: PausableAudio })
    expect(() => player.stop()).not.toThrow()
  })

  it('does not pause a later playback when an earlier one already ended', async () => {
    const player = createAudioPlayer({ audioClass: PausableAudio })
    const first = player.play('first.mp3')
    const firstAudio = PausableAudio.last
    firstAudio.onended()
    await first

    player.play('second.mp3')
    const secondAudio = PausableAudio.last
    player.stop()

    expect(secondAudio.paused).toBe(true)
    expect(firstAudio.paused).toBe(false)
  })
})
