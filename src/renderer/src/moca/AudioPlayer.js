export function createAudioPlayer({ audioClass = Audio } = {}) {
  let current = null

  function play(src) {
    return new Promise((resolve, reject) => {
      const audio = new audioClass(src)
      current = audio

      const settle = (fn) => (...args) => {
        if (current === audio) current = null
        fn(...args)
      }

      audio.onended = settle(() => resolve())
      audio.onerror = settle(() =>
        reject(new Error(`Failed to play stimulus audio: ${src}`))
      )
      // play() rejects when the browser blocks playback (e.g. no user gesture).
      // Propagate that rather than hanging forever waiting for `ended`.
      const started = audio.play()
      if (started && typeof started.catch === 'function') started.catch(settle(reject))
    })
  }

  // Abandon whatever is playing. Deliberately leaves the play() promise
  // unsettled: a stopped stimulus was abandoned, not completed, and resolving
  // would let the caller proceed as though the audio had finished. The hook's
  // generation guard is what actually retires that caller.
  function stop() {
    if (!current) return
    current.pause()
    current = null
  }

  return { play, stop }
}
