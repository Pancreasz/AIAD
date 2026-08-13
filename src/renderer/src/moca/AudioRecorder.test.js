import { describe, it, expect, vi } from 'vitest'
import { createAudioRecorder } from './AudioRecorder.js'

class FakeMediaRecorder {
  constructor(stream) {
    this.stream = stream
    this.mimeType = 'audio/webm'
  }
  start() {
    this.started = true
  }
  stop() {
    if (this.ondataavailable) {
      this.ondataavailable({ data: new Blob(['fake-audio-bytes']) })
    }
    if (this.onstop) this.onstop()
  }
}

describe('createAudioRecorder', () => {
  it('requests the microphone on start and resolves a Blob on stop', async () => {
    const fakeTrack = { stop: vi.fn() }
    const fakeStream = { getTracks: () => [fakeTrack] }
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream)

    const recorder = createAudioRecorder({ mediaRecorderClass: FakeMediaRecorder, getUserMedia })

    await recorder.start()
    const blob = await recorder.stop()

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(blob).toBeInstanceOf(Blob)
    expect(fakeTrack.stop).toHaveBeenCalled()
  })
})
