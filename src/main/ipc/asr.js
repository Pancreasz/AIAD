import { ipcMain } from 'electron'
import { createWhisperClient } from '../asr/whisperClient.js'

export function registerAsrHandlers() {
  const whisperClient = createWhisperClient()

  ipcMain.handle('asr:transcribe', async (_event, { audioBuffer, mimeType, language }) => {
    return whisperClient.transcribe(audioBuffer, mimeType, language)
  })
}
