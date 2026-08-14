import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { createSidecarProcess } from './sidecarProcess.js'

class FakeChild extends EventEmitter {
  constructor() {
    super()
    this.kill = vi.fn()
    this.stdout = new EventEmitter()
    this.stderr = new EventEmitter()
  }
}

function makeSpawn() {
  const children = []
  const spawnImpl = vi.fn(() => {
    const child = new FakeChild()
    children.push(child)
    return child
  })
  return { spawnImpl, children }
}

function healthReturning(status) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status }) })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createSidecarProcess', () => {
  it('spawns the server with the interpreter, script, and port', () => {
    const { spawnImpl } = makeSpawn()
    const sidecar = createSidecarProcess({
      pythonPath: 'C:/venv/python.exe',
      scriptPath: 'C:/app/asr_server.py',
      port: 8765,
      spawnImpl,
      fetchImpl: healthReturning('loading')
    })

    sidecar.start()

    expect(spawnImpl).toHaveBeenCalledWith(
      'C:/venv/python.exe',
      ['C:/app/asr_server.py', '--port', '8765'],
      expect.anything()
    )
    expect(sidecar.baseUrl()).toBe('http://127.0.0.1:8765')
  })

  it('starts out loading and not ready', () => {
    const { spawnImpl } = makeSpawn()
    const sidecar = createSidecarProcess({
      pythonPath: 'py',
      scriptPath: 's.py',
      port: 1,
      spawnImpl,
      fetchImpl: healthReturning('loading')
    })

    sidecar.start()

    expect(sidecar.isReady()).toBe(false)
    expect(sidecar.status()).toBe('loading')
  })

  it('becomes ready once /health reports ready', async () => {
    const { spawnImpl } = makeSpawn()
    const sidecar = createSidecarProcess({
      pythonPath: 'py',
      scriptPath: 's.py',
      port: 1,
      spawnImpl,
      fetchImpl: healthReturning('ready'),
      loadingPollMs: 1000
    })

    sidecar.start()
    await vi.advanceTimersByTimeAsync(1000)

    expect(sidecar.isReady()).toBe(true)
    expect(sidecar.status()).toBe('ready')
  })

  it('respawns once when the process exits unexpectedly', () => {
    const { spawnImpl, children } = makeSpawn()
    const sidecar = createSidecarProcess({
      pythonPath: 'py',
      scriptPath: 's.py',
      port: 1,
      spawnImpl,
      fetchImpl: healthReturning('loading')
    })

    sidecar.start()
    children[0].emit('exit', 1)

    expect(spawnImpl).toHaveBeenCalledTimes(2)
    expect(sidecar.isReady()).toBe(false)
  })

  it('gives up after a second unexpected exit', () => {
    const { spawnImpl, children } = makeSpawn()
    const sidecar = createSidecarProcess({
      pythonPath: 'py',
      scriptPath: 's.py',
      port: 1,
      spawnImpl,
      fetchImpl: healthReturning('loading')
    })

    sidecar.start()
    children[0].emit('exit', 1)
    children[1].emit('exit', 1)

    expect(spawnImpl).toHaveBeenCalledTimes(2)
    expect(sidecar.status()).toBe('unavailable')
  })

  it('stop() kills the child and does not respawn it', () => {
    const { spawnImpl, children } = makeSpawn()
    const sidecar = createSidecarProcess({
      pythonPath: 'py',
      scriptPath: 's.py',
      port: 1,
      spawnImpl,
      fetchImpl: healthReturning('loading')
    })

    sidecar.start()
    sidecar.stop()
    children[0].emit('exit', 0)

    expect(children[0].kill).toHaveBeenCalled()
    expect(spawnImpl).toHaveBeenCalledTimes(1)
    expect(sidecar.status()).toBe('stopped')
  })

  it('reports unavailable when health polling reports an error status', async () => {
    const { spawnImpl } = makeSpawn()
    const sidecar = createSidecarProcess({
      pythonPath: 'py',
      scriptPath: 's.py',
      port: 1,
      spawnImpl,
      fetchImpl: healthReturning('error'),
      loadingPollMs: 1000
    })

    sidecar.start()
    await vi.advanceTimersByTimeAsync(1000)

    expect(sidecar.status()).toBe('unavailable')
    expect(sidecar.isReady()).toBe(false)
  })
})
