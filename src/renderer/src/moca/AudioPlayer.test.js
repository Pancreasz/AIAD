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
