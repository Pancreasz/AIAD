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
  let running = false
  let generation = 0

  function spawnChild(gen) {
    if (gen !== generation) return

    child = spawnImpl(pythonPath, [scriptPath, '--port', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    child.stderr?.on('data', (data) => logger.error(`[asr-sidecar] ${data}`))

    child.on('error', (error) => {
      if (gen !== generation) return
      logger.error(`[asr-sidecar] failed to spawn: ${error.message}`)
      ready = false
      failed = true
    })

    child.on('exit', (code) => {
      if (gen !== generation) return
      ready = false
      if (stopped) return

      if (restarts < maxRestarts) {
        restarts += 1
        logger.error(`[asr-sidecar] exited (${code}); restarting once`)
        spawnChild(gen)
      } else {
        failed = true
        logger.error(`[asr-sidecar] exited (${code}) again; giving up for this session`)
      }
    })
  }

  async function poll(gen) {
    if (gen !== generation || stopped) return

    try {
      const response = await fetchImpl(`${baseUrl}/health`)
      const body = await response.json()
      if (gen !== generation) return
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
      if (gen !== generation) return
      // Sidecar not listening yet; stay in the current state and poll again.
      ready = false
    }

    if (gen === generation && !stopped) {
      timer = setTimeout(() => poll(gen), ready ? readyPollMs : loadingPollMs)
    }
  }

  function start() {
    if (running) return
    running = true
    generation += 1
    const gen = generation

    stopped = false
    failed = false
    restarts = 0
    if (timer) clearTimeout(timer)
    timer = null

    spawnChild(gen)
    timer = setTimeout(() => poll(gen), loadingPollMs)
  }

  function stop() {
    running = false
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
