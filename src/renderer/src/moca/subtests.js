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
  vigilance: 'moca/audio/instr-vigilance.mp3',
  serialSevens: 'moca/audio/instr-serial-sevens.mp3',
  delayedRecall: 'moca/audio/instr-delayed-recall.mp3',
  orientation: 'moca/audio/instr-orientation.mp3'
}

// Vigilance: the patient taps every time they hear the target digit. Straight
// from the user's Thai MoCA-Basic form -- 29 digits, 11 of them targets. A
// single wrong digit here changes every score the subtest produces and looks
// completely normal, so subtests.test.js asserts its shape.
//
// The three consecutive targets at positions 18-20 are the structurally
// important part: they are where a patient tapping perseveratively and one
// genuinely tracking produce identical output, and the non-target that follows
// separates them.
const VIGILANCE_SEQUENCE = '52139411806215194511141905112'
const VIGILANCE_TARGET = '1'
const VIGILANCE_INTERVAL_MS = 1000
// Silence between the instruction and the first digit, so the sequence does
// not start on the heels of the instruction's last syllable. Silence rather
// than a countdown: a countdown hands the patient a rhythm to lock onto
// before the task begins.
const VIGILANCE_LEAD_IN_MS = 1000

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
    id: 'vigilance',
    section: 'Attention',
    instructionTextEn:
      'You will hear a list of numbers. Tap the button every time you hear the number 1.',
    instructionTextTh: 'คุณจะได้ยินตัวเลขหลายตัว ให้เคาะปุ่มทุกครั้งที่ได้ยินเลข 1',
    countdownSec: 0,
    // The sequence's own fixed duration: 1s lead-in plus 29 digits at 1s each.
    // A recorded fact rather than a deadline -- the subtest ends when the audio
    // ends, so there is nothing here to enforce.
    timeLimitSec: 30,
    scorerId: 'vigilance',
    responseMode: 'tap',
    sequence: VIGILANCE_SEQUENCE,
    target: VIGILANCE_TARGET,
    intervalMs: VIGILANCE_INTERVAL_MS,
    leadInMs: VIGILANCE_LEAD_IN_MS,
    instructionAudio: INSTR.vigilance
    // No `audio`: the stimulus is 29 scheduled files, described by `sequence`
    // rather than by one path.
  },
  {
    id: 'serial-sevens',
    section: 'Attention',
    instructionTextEn:
      'Starting at 100, subtract 7, then keep subtracting 7 from each answer. Say each answer out loud.',
    instructionTextTh: 'เริ่มจาก 100 ให้ลบออกทีละ 7 แล้วลบ 7 จากคำตอบไปเรื่อย ๆ พูดคำตอบออกมาดัง ๆ',
    countdownSec: 0,
    // A budget for the process-data record, not a deadline: nothing in the
    // app enforces it and no clock is shown. Five subtractions with normal
    // pauses fit comfortably inside 60s, and a slow but correct patient is
    // never cut off.
    timeLimitSec: 60,
    scorerId: 'serial-sevens',
    instructionAudio: INSTR.serialSevens
    // No `audio`: unlike Digit Span and Memory there is no stimulus to play.
    // The starting number lives in the instruction, and the scorer's own
    // START_VALUE is the single source of truth for 100.
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
