export function createAudioPlayer({ audioClass = Audio } = {}) {
  function play(src) {
    return new Promise((resolve, reject) => {
      const audio = new audioClass(src)
      audio.onended = () => resolve()
      audio.onerror = () => reject(new Error(`Failed to play stimulus audio: ${src}`))
      // play() rejects when the browser blocks playback (e.g. no user gesture).
      // Propagate that rather than hanging forever waiting for `ended`.
      const started = audio.play()
      if (started && typeof started.catch === 'function') started.catch(reject)
    })
  }

  return { play }
}
