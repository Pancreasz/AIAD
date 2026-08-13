import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers = new Map()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel, handler) => handlers.set(channel, handler)
  }
}))

const { registerAsrHandlers } = await import('./asr.js')

describe('registerAsrHandlers', () => {
  beforeEach(() => {
    handlers.clear()
    delete process.env.OPENAI_API_KEY
  })

  it('registers without throwing when OPENAI_API_KEY is missing', () => {
    expect(() => registerAsrHandlers()).not.toThrow()
    expect(handlers.has('asr:transcribe')).toBe(true)
  })

  it('surfaces the missing-key error only when transcribe is actually invoked', async () => {
    registerAsrHandlers()
    await expect(
      handlers.get('asr:transcribe')({}, { audioBuffer: new ArrayBuffer(8), mimeType: 'audio/webm', language: 'th' })
    ).rejects.toThrow('OPENAI_API_KEY is not set')
  })
})
