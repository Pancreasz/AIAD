import { spawn as nodeSpawn } from 'child_process'

export function createSidecarProcess({
  pythonPath,
  scriptPath,
  port,
  spawnImpl = nodeSpawn,
  fetchImpl = fetch,
  loadingPollMs = 1000,
  readyPollMs = 10000,
  maxRestarts = 1,
  logger = console
}) {
  const baseUrl = `http://127.0.0.1:${port}`

  let child = null
  let ready = false
  let stopped = false
  let failed = false
  let restarts = 0
  let timer = null

  function spawnChild() {
    child = spawnImpl(pythonPath, [scriptPath, '--port', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    child.stderr?.on('data', (data) => logger.error(`[asr-sidecar] ${data}`))

    child.on('error', (error) => {
      logger.error(`[asr-sidecar] failed to spawn: ${error.message}`)
      ready = false
      failed = true
    })

    child.on('exit', (code) => {
      ready = false
      if (stopped) return

      if (restarts < maxRestarts) {
        restarts += 1
        logger.error(`[asr-sidecar] exited (${code}); restarting once`)
        spawnChild()
      } else {
        failed = true
        logger.error(`[asr-sidecar] exited (${code}) again; giving up for this session`)
      }
    })
  }

  async function poll() {
    if (stopped) return

    try {
      const response = await fetchImpl(`${baseUrl}/health`)
      const body = await response.json()
      if (body.status === 'ready') {
        ready = true
        failed = false
      } else if (body.status === 'error') {
        ready = false
        failed = true
      } else {
        ready = false
      }
    } catch {
      // Sidecar not listening yet; stay in the current state and poll again.
      ready = false
    }

    if (!stopped) {
      timer = setTimeout(poll, ready ? readyPollMs : loadingPollMs)
    }
  }

  function start() {
    stopped = false
    failed = false
    restarts = 0
    spawnChild()
    timer = setTimeout(poll, loadingPollMs)
  }

  function stop() {
    stopped = true
    ready = false
    if (timer) clearTimeout(timer)
    timer = null
    if (child) child.kill()
  }

  function isReady() {
    return ready && !stopped
  }

  function status() {
    if (stopped) return 'stopped'
    if (ready) return 'ready'
    if (failed) return 'unavailable'
    return 'loading'
  }

  return { start, stop, isReady, status, baseUrl: () => baseUrl }
}
