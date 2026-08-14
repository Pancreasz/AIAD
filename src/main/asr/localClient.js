export function createLocalClient({ baseUrl, fetchImpl = fetch, timeoutMs = 60000 } = {}) {
  if (!baseUrl) {
    throw new Error('baseUrl is required')
  }

  async function transcribe(audioBuffer, mimeType, language) {
    const extension = mimeType.includes('webm') ? 'webm' : 'wav'
    const form = new FormData()
    form.append('file', new Blob([audioBuffer], { type: mimeType }), `audio.${extension}`)
    form.append('language', language)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let response
    try {
      response = await fetchImpl(`${baseUrl}/transcribe`, {
        method: 'POST',
        body: form,
        signal: controller.signal
      })
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Local ASR timed out after ${timeoutMs}ms`)
      }
      throw new Error(`Local ASR unreachable: ${error.message}`)
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      const detail = await response.text()
      throw new Error(`Local ASR error (${response.status}): ${detail}`)
    }

    const data = await response.json()
    if (typeof data.text !== 'string') {
      throw new Error(`Local ASR returned a malformed response: ${JSON.stringify(data)}`)
    }
    return data.text
  }

  return { transcribe }
}
