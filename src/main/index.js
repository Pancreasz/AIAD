// electron-vite only injects env vars prefixed with VITE_/MAIN_VITE_/... and only
// via import.meta.env, so `.env` is loaded here to populate process.env instead.
import 'dotenv/config'
import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerAsrHandlers } from './ipc/asr.js'
import { registerScoringHandlers } from './ipc/scoring.js'
import { createServer } from 'net'
import { createSidecarProcess } from './asr/sidecarProcess.js'
import { venvPython, SERVER_SCRIPT } from '../../scripts/venvPython.mjs'

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

let sidecar = null

async function startSidecar() {
  const configured = Number(process.env.MOCA_ASR_PORT || 0)
  const port = configured > 0 ? configured : await findFreePort()
  sidecar = createSidecarProcess({
    pythonPath: venvPython(),
    scriptPath: SERVER_SCRIPT,
    port
  })
  sidecar.start()
  return sidecar
}

function createWindow() {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // Deliberately NOT awaited: the window must appear while Python loads the
  // model in the background. See the spec's "Startup must not block the window".
  const pendingSidecar = startSidecar()

  registerAsrHandlers({
    isReady: () => (sidecar ? sidecar.isReady() : false),
    status: () => (sidecar ? sidecar.status() : 'loading'),
    baseUrl: () => (sidecar ? sidecar.baseUrl() : 'http://127.0.0.1:0')
  })
  registerScoringHandlers()

  pendingSidecar.catch((error) => console.error(`[asr-sidecar] ${error.message}`))

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  if (sidecar) sidecar.stop()
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
