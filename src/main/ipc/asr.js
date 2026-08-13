import { ipcMain } from 'electron'
import { createWhisperClient } from '../asr/whisperClient.js'

export function registerAsrHandlers() {
  // Built lazily: a missing OPENAI_API_KEY must fail only the transcribe call,
  // not registration — which runs before createWindow() and would otherwise
  // leave the app with no window at all.
  let whisperClient = null

  ipcMain.handle('asr:transcribe', async (_event, { audioBuffer, mimeType, language }) => {
    if (!whisperClient) whisperClient = createWhisperClient()
    return whisperClient.transcribe(audioBuffer, mimeType, language)
  })
}
