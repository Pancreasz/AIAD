import { existsSync } from 'fs'
import { resolve } from 'path'

export const SIDECAR_DIR = resolve('sidecar')
export const VENV_DIR = resolve(SIDECAR_DIR, '.venv')
export const SERVER_SCRIPT = resolve(SIDECAR_DIR, 'app_combined.py')

export function venvPython() {
  return process.platform === 'win32'
    ? resolve(VENV_DIR, 'Scripts', 'python.exe')
    : resolve(VENV_DIR, 'bin', 'python')
}

export function venvExists() {
  return existsSync(venvPython())
}
