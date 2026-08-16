// Relative, never root-absolute: production loads via file://, where a leading
// slash resolves against the drive root instead of the app bundle.
const srcFor = (digit) => `moca/audio/digit-${digit}.mp3`

// Separate from AudioPlayer.js on purpose. That one plays one file and
// resolves on `ended`; this one schedules many and resolves when the last
// WINDOW closes, which is a different moment from when the last sound stops.
export function createDigitSequencePlayer({
  audioClass = Audio,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  const elements = new Map()
  let timers = []
  let cancelled = false
  // The element currently sounding, if any. Tracked because the recordings can
  // outlast their slot and must be cut off rather than left to overlap.
  let sounding = null

  // Preloading is not an optimisation. A cold element adds tens of
  // milliseconds of decode delay before its first sound, varying per file --
  // which lands in the scoring as if it were patient reaction time.
  function preload(digits) {
    return Promise.all(
      digits.map(
        (digit) =>
          new Promise((resolve, reject) => {
            const audio = new audioClass(srcFor(digit))
            audio.preload = 'auto'
            audio.oncanplaythrough = () => resolve()
            audio.onerror = () => reject(new Error(`Failed to load digit audio: ${srcFor(digit)}`))
            elements.set(digit, audio)
            if (typeof audio.load === 'function') audio.load()
          })
      )
    ).then(() => undefined)
  }

  function play(sequence, { intervalMs, leadInMs = 0, onStart } = {}) {
    // Retire anything still scheduled from a previous call. Note this must
    // cancel the timers, not merely drop the references -- an emptied array
    // would leave the old sequence sounding and no longer stoppable.
    stop()
    cancelled = false
    const digits = [...sequence]
    const start = now()

    return new Promise((resolve) => {
      // Every delay is recomputed against one shared start reference. Chaining
      // setTimeout(fn, interval) instead lets each timer's few milliseconds of
      // lateness carry into the next, which over 29 digits drifts far enough
      // to matter against a 1000ms window.
      const at = (offsetMs, fn) => {
        timers.push(setTimer(fn, Math.max(0, start + offsetMs - now())))
      }

      digits.forEach((digit, index) => {
        at(leadInMs + index * intervalMs, () => {
          if (cancelled) return
          // Fires at the first digit's onset, which is the origin every tap
          // offset is measured from -- not when play() was called, since the
          // lead-in sits in between.
          if (index === 0 && onStart) onStart()

          const audio = elements.get(digit)
          if (!audio) return
          // Cut off whatever is still sounding before this digit starts. A
          // recording longer than the interval would otherwise bleed its tail
          // over the next digit -- worst across a run of repeated targets,
          // where the whole point is that the patient hears each one as a
          // separate digit. Owning the boundary here means an over-long file
          // costs audio quality, never scoring accuracy.
          if (sounding && sounding !== audio) sounding.pause()
          // The same element plays repeatedly, and is at its end by the second
          // time round. Rewinding also truncates it when a digit repeats.
          audio.currentTime = 0
          sounding = audio
          const started = audio.play()
          // A digit that fails to sound is a scoring problem, not a crash: it
          // shows up as a miss in the result rather than killing the session
          // mid-sequence.
          if (started && typeof started.catch === 'function') started.catch(() => {})
        })
      })

      at(leadInMs + digits.length * intervalMs, () => {
        if (cancelled) return
        resolve()
      })
    })
  }

  // Deliberately leaves play()'s promise unsettled, exactly as
  // AudioPlayer.stop() does: a stopped sequence was abandoned, not completed,
  // and resolving would let the caller score a subtest that never finished.
  // The hook's generation guard is what retires that caller.
  function stop() {
    cancelled = true
    for (const timer of timers) clearTimer(timer)
    timers = []
    // Only one element can be sounding at a time now, so silence that one
    // rather than sweeping every preloaded element.
    if (sounding) {
      sounding.pause()
      sounding = null
    }
  }

  return { preload, play, stop }
}
