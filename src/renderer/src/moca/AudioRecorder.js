export function createAudioRecorder({ mediaRecorderClass = MediaRecorder, getUserMedia } = {}) {
  const requestMic =
    getUserMedia ?? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  let recorder = null
  let chunks = []
  let stream = null

  async function start() {
    stream = await requestMic({ audio: true })
    chunks = []
    recorder = new mediaRecorderClass(stream)
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.start()
  }

  function stop() {
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType })
        stream.getTracks().forEach((track) => track.stop())
        resolve(blob)
      }
      recorder.stop()
    })
  }

  return { start, stop }
}
