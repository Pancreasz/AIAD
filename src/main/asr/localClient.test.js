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

  it('sends the audio as a file part and the language as a form field', async () => {
    let capturedBody
    const fetchImpl = vi.fn((_url, options) => {
      capturedBody = options.body
      return Promise.resolve({ ok: true, json: async () => ({ text: 'ok' }) })
    })
    const client = createLocalClient({ baseUrl: 'http://127.0.0.1:9999', fetchImpl })

    await client.transcribe(new ArrayBuffer(8), 'audio/webm', 'th')

    expect(capturedBody).toBeInstanceOf(FormData)
    expect(capturedBody.get('language')).toBe('th')
    expect(capturedBody.get('file')).toBeInstanceOf(Blob)
    expect(capturedBody.get('file').name).toBe('audio.webm')
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

  it('aborts the request when the timeout elapses', async () => {
    vi.useFakeTimers()
    try {
      let capturedSignal
      const fetchImpl = vi.fn((_url, options) => {
        capturedSignal = options.signal
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const abortError = new Error('aborted')
            abortError.name = 'AbortError'
            reject(abortError)
          })
        })
      })
      const client = createLocalClient({
        baseUrl: 'http://127.0.0.1:9999',
        fetchImpl,
        timeoutMs: 5000
      })

      const pending = client
        .transcribe(new ArrayBuffer(8), 'audio/webm', 'th')
        .catch((error) => error)

      expect(capturedSignal).toBeDefined()
      expect(capturedSignal.aborted).toBe(false)

      await vi.advanceTimersByTimeAsync(5000)

      const error = await pending
      expect(error.message).toBe('Local ASR timed out after 5000ms')
      expect(capturedSignal.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports an unreachable sidecar distinctly from a timeout', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const client = createLocalClient({ baseUrl: 'http://127.0.0.1:9999', fetchImpl })

    await expect(client.transcribe(new ArrayBuffer(8), 'audio/webm', 'th')).rejects.toThrow(
      'Local ASR unreachable: ECONNREFUSED'
    )
  })

  it('throws a descriptive error when a 200 response body is missing text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({})
    })
    const client = createLocalClient({ baseUrl: 'http://127.0.0.1:9999', fetchImpl })

    await expect(client.transcribe(new ArrayBuffer(8), 'audio/webm', 'th')).rejects.toThrow(
      'Local ASR returned a malformed response'
    )
  })

  it('treats an empty string transcript as a valid result (silence), not a malformed response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: '' })
    })
    const client = createLocalClient({ baseUrl: 'http://127.0.0.1:9999', fetchImpl })

    const result = await client.transcribe(new ArrayBuffer(8), 'audio/webm', 'th')

    expect(result).toBe('')
  })
})
