import { ipcMain } from 'electron'
import { createWhisperClient } from '../asr/whisperClient.js'
import { createLocalClient } from '../asr/localClient.js'
import { createTranscriber } from '../asr/transcriber.js'

const DEFAULT_TIMEOUT_MS = 60000

// A malformed MOCA_ASR_TIMEOUT_MS (missing, non-numeric, zero, or negative)
// must fall back to the default rather than produce NaN: setTimeout coerces
// NaN to ~0ms, which would abort every local transcription instantly and
// silently disable the local engine for the whole session.
export function resolveTimeoutMs(raw) {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS
}

export function registerAsrHandlers(sidecar) {
  // The API client is resolved once and memoized (constructing it reads the
  // env var and can throw). The local client is rebuilt per call so it always
  // reads the sidecar's CURRENT baseUrl -- the port is assigned asynchronously
  // at startup, so caching a URL captured on the first call could pin a stale one.
  let apiClient
  let apiClientResolved = false

  function getApiClient() {
    if (apiClientResolved) return apiClient
    apiClientResolved = true
    try {
      apiClient = createWhisperClient()
    } catch {
      // No OPENAI_API_KEY. Local-only; the transcriber reports this if local fails.
      apiClient = null
    }
    return apiClient
  }

  ipcMain.handle('asr:transcribe', async (_event, { audioBuffer, mimeType, language }) => {
    const transcriber = createTranscriber({
      localClient: createLocalClient({
        baseUrl: sidecar.baseUrl(),
        timeoutMs: resolveTimeoutMs(process.env.MOCA_ASR_TIMEOUT_MS)
      }),
      apiClient: getApiClient(),
      isLocalReady: () => sidecar.isReady(),
      allowCloudFallback: process.env.MOCA_ALLOW_CLOUD_FALLBACK !== 'false'
    })

    return transcriber.transcribe(audioBuffer, mimeType, language)
  })

  ipcMain.handle('asr:status', async () => sidecar.status())
}
