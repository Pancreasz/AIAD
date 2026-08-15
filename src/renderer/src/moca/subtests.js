import lionImage from '../assets/moca/images/lion.png'
import rhinoImage from '../assets/moca/images/rhino.png'
import camelImage from '../assets/moca/images/camel.png'

// Served from src/renderer/public, so these are URL paths rather than imports.
// See this task's note: an import of a not-yet-recorded file fails the build,
// while a missing file here is a runtime error the app surfaces with Retry.
//
// Deliberately relative (no leading slash). In dev the renderer is served
// over HTTP from the server root, where a root-absolute path also happens to
// work -- but production loads via loadFile(), i.e. the file:// protocol,
// where a root-absolute path resolves against the drive root
// (file:///C:/moca/audio/...) rather than the app bundle. A relative path
// resolves against the current document in both cases.
// Stimulus audio: the test content itself, played immediately before the mic
// opens.
const MEMORY_WORDS_AUDIO = 'moca/audio/memory-words.mp3'
const DIGITS_FORWARD_AUDIO = 'moca/audio/digits-forward.mp3'
const DIGITS_BACKWARD_AUDIO = 'moca/audio/digits-backward.mp3'

// Instruction narration: spoken versions of instructionTextTh, played before
// the stimulus. Separate from `audio` because Memory and Digit Span need both,
// in that order -- the sequence a clinician administers in.
const INSTR = {
  naming: 'moca/audio/instr-naming.mp3',
  memory1: 'moca/audio/instr-memory-1.mp3',
  memory2: 'moca/audio/instr-memory-2.mp3',
  digitForward: 'moca/audio/instr-digit-forward.mp3',
  digitBackward: 'moca/audio/instr-digit-backward.mp3',
  delayedRecall: 'moca/audio/instr-delayed-recall.mp3',
  orientation: 'moca/audio/instr-orientation.mp3'
}

export const SUBTESTS = [
  {
    id: 'naming',
    section: 'Naming',
    // Order matters only for display. The alt text deliberately does NOT name
    // the animal: it would hand the answer to a screen reader, and it renders
    // as fallback text if an image fails to load, turning a naming test into
    // a reading test.
    images: [lionImage, rhinoImage, camelImage],
    instructionTextEn:
      'You will see three animals. After the countdown, say the name of all three animals without stopping.',
    instructionTextTh: 'คุณจะเห็นสัตว์สามชนิด หลังนับถอยหลัง ให้บอกชื่อสัตว์ทั้งสามโดยไม่หยุด',
    countdownSec: 3,
    timeLimitSec: 15,
    scorerId: 'naming',
    instructionAudio: INSTR.naming
  },
  {
    id: 'memory-registration-1',
    section: 'Memory (trial 1)',
    instructionTextEn:
      'Listen carefully to five words. When they finish, repeat as many as you can.',
    instructionTextTh: 'ตั้งใจฟังคำห้าคำ เมื่อจบแล้ว ให้พูดทวนให้ได้มากที่สุด',
    countdownSec: 0,
    timeLimitSec: 30,
    scorerId: 'memory-registration',
    instructionAudio: INSTR.memory1,
    audio: MEMORY_WORDS_AUDIO
  },
  {
    id: 'memory-registration-2',
    section: 'Memory (trial 2)',
    instructionTextEn: 'Listen to the same five words again, then repeat as many as you can.',
    instructionTextTh: 'ฟังคำทั้งห้าอีกครั้ง แล้วพูดทวนให้ได้มากที่สุด',
    countdownSec: 0,
    timeLimitSec: 30,
    scorerId: 'memory-registration',
    instructionAudio: INSTR.memory2,
    audio: MEMORY_WORDS_AUDIO
  },
  {
    id: 'digit-span-forward',
    section: 'Attention',
    instructionTextEn: 'Listen to the numbers, then repeat them in the same order.',
    instructionTextTh: 'ฟังตัวเลขต่อไปนี้ แล้วพูดทวนตามลำดับ',
    countdownSec: 0,
    timeLimitSec: 7,
    scorerId: 'digit-span-forward',
    instructionAudio: INSTR.digitForward,
    audio: DIGITS_FORWARD_AUDIO,
    expectedSequence: '21854'
  },
  {
    id: 'digit-span-backward',
    section: 'Attention',
    instructionTextEn: 'Listen to the numbers, then repeat them in reverse order.',
    instructionTextTh: 'ฟังตัวเลขต่อไปนี้ แล้วพูดทวนย้อนกลับ',
    countdownSec: 0,
    timeLimitSec: 7,
    scorerId: 'digit-span-backward',
    instructionAudio: INSTR.digitBackward,
    audio: DIGITS_BACKWARD_AUDIO,
    // Patient hears "742" and must say it reversed: "247".
    expectedSequence: '247'
  },
  {
    id: 'delayed-recall',
    section: 'Delayed Recall',
    instructionTextEn: 'Tell me as many of those five words as you can remember.',
    instructionTextTh: 'บอกคำทั้งห้าคำที่จำได้ให้มากที่สุด',
    countdownSec: 0,
    timeLimitSec: 30,
    scorerId: 'delayed-recall',
    instructionAudio: INSTR.delayedRecall
  },
  {
    id: 'orientation',
    section: 'Orientation',
    instructionTextEn: "Tell me today's day, month, year, date, place, and province.",
    instructionTextTh: 'บอกวัน เดือน ปี วันที่ สถานที่ และจังหวัดในวันนี้',
    countdownSec: 0,
    timeLimitSec: 15,
    scorerId: 'orientation',
    instructionAudio: INSTR.orientation
  }
]
