import { spawnSync } from 'child_process'
import { resolve } from 'path'
import { SIDECAR_DIR, VENV_DIR, venvPython, venvExists } from './venvPython.mjs'

const basePython = process.env.MOCA_ASR_PYTHON || 'python'
const model = process.env.MOCA_ASR_MODEL || 'deepdml/faster-whisper-large-v3-turbo-ct2'

function run(command, args, label) {
  console.log(`\n> ${label}`)
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) {
    console.error(`\nCould not run ${command}: ${result.error.message}`)
    process.exit(1)
  }
  return result.status ?? 1
}

function runOrExit(command, args, label) {
  const status = run(command, args, label)
  if (status !== 0) process.exit(status)
}

if (venvExists()) {
  console.log(`Reusing existing venv at ${VENV_DIR}`)
} else {
  runOrExit(basePython, ['-m', 'venv', VENV_DIR], `Creating venv at ${VENV_DIR}`)
}

const py = venvPython()
runOrExit(py, ['-m', 'pip', 'install', '--upgrade', 'pip', '--quiet'], 'Upgrading pip')

const installStatus = run(
  py,
  ['-m', 'pip', 'install', '-r', resolve(SIDECAR_DIR, 'requirements.txt')],
  'Installing sidecar requirements'
)
if (installStatus !== 0) {
  console.error(
    [
      '',
      'pip install failed.',
      '',
      'If the error mentions ctranslate2, this Python version has no wheel yet.',
      'Create a 3.11 environment and retry:',
      '',
      '  conda create -n moca-asr python=3.11 -y',
      '  set MOCA_ASR_PYTHON=%USERPROFILE%\\miniconda3\\envs\\moca-asr\\python.exe',
      '  npm run setup:asr',
      ''
    ].join('\n')
  )
  process.exit(installStatus)
}

runOrExit(
  py,
  [
    '-c',
    `from faster_whisper import WhisperModel; WhisperModel(${JSON.stringify(model)}, device="cpu", compute_type="int8"); print("model cached")`
  ],
  `Pre-downloading ${model} (~1.6 GB, one time only)`
)

console.log('\nASR sidecar ready. Run `npm run dev`.')
