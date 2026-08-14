function failure(localCause, apiCause) {
  return new Error(
    `Transcription failed.\n  local:  ${localCause}\n  openai: ${apiCause}`
  )
}

export function createTranscriber({
  localClient,
  apiClient,
  isLocalReady,
  allowCloudFallback = true
}) {
  async function transcribe(audioBuffer, mimeType, language) {
    let localCause

    if (isLocalReady()) {
      try {
        // An empty string is a legitimate result (the patient said nothing) and
        // returns here rather than falling through to the cloud.
        const text = await localClient.transcribe(audioBuffer, mimeType, language)
        return { text, engine: 'local' }
      } catch (error) {
        localCause = error.message
      }
    } else {
      localCause = 'sidecar not ready'
    }

    if (!allowCloudFallback) {
      throw failure(localCause, 'cloud fallback disabled (MOCA_ALLOW_CLOUD_FALLBACK=false)')
    }

    if (!apiClient) {
      throw failure(localCause, 'OPENAI_API_KEY is not set')
    }

    try {
      const text = await apiClient.transcribe(audioBuffer, mimeType, language)
      return { text, engine: 'openai' }
    } catch (error) {
      throw failure(localCause, error.message)
    }
  }

  return { transcribe }
}
