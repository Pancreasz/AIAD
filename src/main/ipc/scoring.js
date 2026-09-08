import { ipcMain } from 'electron'
import { scoreItem } from '../scoring/index.js'

export function registerScoringHandlers(options = {}) {
  ipcMain.handle('scoring:score-item', async (_event, { subtestId, transcript, context }) => {
    return scoreItem(subtestId, transcript, context, options)
  })
}
