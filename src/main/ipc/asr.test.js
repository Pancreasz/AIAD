import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers = new Map()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel, handler) => handlers.set(channel, handler)
  }
}))

const { registerAsrHandlers, resolveTimeoutMs } = await import('./asr.js')

function fakeSidecar({ ready = false, status = 'loading' } = {}) {
  return {
    isReady: () => ready,
    status: () => status,
    baseUrl: () => 'http://127.0.0.1:9999'
  }
}

const PAYLOAD = { audioBuffer: new ArrayBuffer(8), mimeType: 'audio/webm', language: 'th' }

describe('registerAsrHandlers', () => {
  beforeEach(() => {
    handlers.clear()
    delete process.env.OPENAI_API_KEY
    delete process.env.MOCA_ALLOW_CLOUD_FALLBACK
  })

  it('registers both channels without throwing when nothing is configured', () => {
    expect(() => registerAsrHandlers(fakeSidecar())).not.toThrow()
    expect(handlers.has('asr:transcribe')).toBe(true)
    expect(handlers.has('asr:status')).toBe(true)
  })

  it('reports the sidecar status through asr:status', async () => {
    registerAsrHandlers(fakeSidecar({ status: 'ready' }))
    await expect(handlers.get('asr:status')({})).resolves.toBe('ready')
  })

  it('surfaces both failure causes when local is down and no API key is set', async () => {
    registerAsrHandlers(fakeSidecar({ ready: false }))
    await expect(handlers.get('asr:transcribe')({}, PAYLOAD)).rejects.toThrow(
      'OPENAI_API_KEY is not set'
    )
  })
})

describe('resolveTimeoutMs', () => {
  it('falls back to 60000 for missing, non-numeric, zero, or negative values', () => {
    expect(resolveTimeoutMs(undefined)).toBe(60000)
    expect(resolveTimeoutMs('')).toBe(60000)
    expect(resolveTimeoutMs('not-a-number')).toBe(60000)
    expect(resolveTimeoutMs('0')).toBe(60000)
    expect(resolveTimeoutMs('-5')).toBe(60000)
  })

  it('uses the configured value when it is a positive finite number', () => {
    expect(resolveTimeoutMs('5000')).toBe(5000)
  })
})
