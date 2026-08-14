import { describe, it, expect, vi } from 'vitest'
import { createLocalClient } from './localClient.js'

describe('createLocalClient', () => {
  it('throws if no baseUrl is provided', () => {
    expect(() => createLocalClient({})).toThrow('baseUrl is required')
  })

  it('posts the audio to the sidecar and returns the transcript text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'สิงโต แรด อูฐ' })
    })
    const client = createLocalClient({ baseUrl: 'http://127.0.0.1:9999', fetchImpl })

    const result = await client.transcribe(new ArrayBuffer(8), 'audio/webm', 'th')

    expect(result).toBe('สิงโต แรด อูฐ')
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:9999/transcribe',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('throws a descriptive error when the sidecar responds with a non-ok status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'model not loaded'
    })
    const client = createLocalClient({ baseUrl: 'http://127.0.0.1:9999', fetchImpl })

    await expect(client.transcribe(new ArrayBuffer(8), 'audio/webm', 'th')).rejects.toThrow(
      'Local ASR error (503): model not loaded'
    )
  })

  it('reports a timeout distinctly when the request aborts', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    const fetchImpl = vi.fn().mockRejectedValue(abortError)
    const client = createLocalClient({
      baseUrl: 'http://127.0.0.1:9999',
      fetchImpl,
      timeoutMs: 1234
    })

    await expect(client.transcribe(new ArrayBuffer(8), 'audio/webm', 'th')).rejects.toThrow(
      'Local ASR timed out after 1234ms'
    )
  })

  it('reports an unreachable sidecar distinctly from a timeout', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const client = createLocalClient({ baseUrl: 'http://127.0.0.1:9999', fetchImpl })

    await expect(client.transcribe(new ArrayBuffer(8), 'audio/webm', 'th')).rejects.toThrow(
      'Local ASR unreachable: ECONNREFUSED'
    )
  })
})
