import { describe, it, expect, vi } from 'vitest'
import { createTranscriber } from './transcriber.js'

const BUFFER = new ArrayBuffer(8)

function clients({ localResult, localError, apiResult, apiError } = {}) {
  const localClient = {
    transcribe: vi.fn(() =>
      localError ? Promise.reject(new Error(localError)) : Promise.resolve(localResult)
    )
  }
  const apiClient = {
    transcribe: vi.fn(() =>
      apiError ? Promise.reject(new Error(apiError)) : Promise.resolve(apiResult)
    )
  }
  return { localClient, apiClient }
}

describe('createTranscriber', () => {
  it('uses the local engine when it is ready and succeeds', async () => {
    const { localClient, apiClient } = clients({ localResult: 'สิงโต' })
    const transcriber = createTranscriber({
      localClient,
      apiClient,
      isLocalReady: () => true
    })

    const result = await transcriber.transcribe(BUFFER, 'audio/webm', 'th')

    expect(result).toEqual({ text: 'สิงโต', engine: 'local' })
    expect(apiClient.transcribe).not.toHaveBeenCalled()
  })

  it('skips local entirely when the sidecar is not ready', async () => {
    const { localClient, apiClient } = clients({ apiResult: 'แรด' })
    const transcriber = createTranscriber({
      localClient,
      apiClient,
      isLocalReady: () => false
    })

    const result = await transcriber.transcribe(BUFFER, 'audio/webm', 'th')

    expect(result).toEqual({ text: 'แรด', engine: 'openai' })
    expect(localClient.transcribe).not.toHaveBeenCalled()
  })

  it('falls back to the API when a ready local engine throws', async () => {
    const { localClient, apiClient } = clients({ localError: 'boom', apiResult: 'อูฐ' })
    const transcriber = createTranscriber({
      localClient,
      apiClient,
      isLocalReady: () => true
    })

    const result = await transcriber.transcribe(BUFFER, 'audio/webm', 'th')

    expect(result).toEqual({ text: 'อูฐ', engine: 'openai' })
    expect(localClient.transcribe).toHaveBeenCalled()
  })

  it('does NOT fall back when the local engine returns an empty transcript', async () => {
    const { localClient, apiClient } = clients({ localResult: '' })
    const transcriber = createTranscriber({
      localClient,
      apiClient,
      isLocalReady: () => true
    })

    const result = await transcriber.transcribe(BUFFER, 'audio/webm', 'th')

    expect(result).toEqual({ text: '', engine: 'local' })
    expect(apiClient.transcribe).not.toHaveBeenCalled()
  })

  it('reports both causes when local and the API both fail', async () => {
    const { localClient, apiClient } = clients({ localError: 'sidecar died', apiError: 'HTTP 401' })
    const transcriber = createTranscriber({
      localClient,
      apiClient,
      isLocalReady: () => true
    })

    const error = await transcriber.transcribe(BUFFER, 'audio/webm', 'th').catch((e) => e)

    expect(error.message).toContain('sidecar died')
    expect(error.message).toContain('HTTP 401')
  })

  it('reports a missing API key as the fallback cause when apiClient is null', async () => {
    const { localClient } = clients({ localError: 'sidecar died' })
    const transcriber = createTranscriber({
      localClient,
      apiClient: null,
      isLocalReady: () => true
    })

    const error = await transcriber.transcribe(BUFFER, 'audio/webm', 'th').catch((e) => e)

    expect(error.message).toContain('OPENAI_API_KEY is not set')
  })

  it('never calls the API when cloud fallback is disabled', async () => {
    const { localClient, apiClient } = clients({ localError: 'sidecar died' })
    const transcriber = createTranscriber({
      localClient,
      apiClient,
      isLocalReady: () => true,
      allowCloudFallback: false
    })

    const error = await transcriber.transcribe(BUFFER, 'audio/webm', 'th').catch((e) => e)

    expect(apiClient.transcribe).not.toHaveBeenCalled()
    expect(error.message).toContain('cloud fallback disabled')
  })
})
