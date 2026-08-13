export function createWhisperClient({
  apiKey = process.env.OPENAI_API_KEY,
  fetchImpl = fetch
} = {}) {
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set')
  }

  async function transcribe(audioBuffer, mimeType, language) {
    const extension = mimeType.includes('webm') ? 'webm' : 'wav'
    const form = new FormData()
    form.append('file', new Blob([audioBuffer], { type: mimeType }), `audio.${extension}`)
    form.append('model', 'whisper-1')
    form.append('language', language)

    const response = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Whisper API error (${response.status}): ${errorText}`)
    }

    const data = await response.json()
    return data.text
  }

  return { transcribe }
}
