import { spawnSync } from 'child_process'
import { venvPython, venvExists } from './venvPython.mjs'

if (!venvExists()) {
  console.error('No sidecar venv found. Run `npm run setup:asr` first.')
  process.exit(1)
}

const result = spawnSync(venvPython(), ['-m', 'pytest', 'sidecar', '-q'], { stdio: 'inherit' })
process.exit(result.status ?? 1)
