import { describe, it, expect, vi } from 'vitest'
import { createWhisperClient } from './whisperClient.js'

describe('createWhisperClient', () => {
  it('throws if no API key is provided', () => {
    expect(() => createWhisperClient({ apiKey: undefined })).toThrow('OPENAI_API_KEY is not set')
  })

  it('sends the audio to the Whisper API and returns the transcript text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'สิงโต แรด อูฐ' })
    })
    const client = createWhisperClient({ apiKey: 'test-key', fetchImpl })

    const result = await client.transcribe(new ArrayBuffer(8), 'audio/webm', 'th')

    expect(result).toBe('สิงโต แรด อูฐ')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/transcriptions',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('throws a descriptive error when the API responds with a non-ok status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Invalid API key'
    })
    const client = createWhisperClient({ apiKey: 'bad-key', fetchImpl })

    await expect(client.transcribe(new ArrayBuffer(8), 'audio/webm', 'th')).rejects.toThrow(
      'Whisper API error (401): Invalid API key'
    )
  })
})
