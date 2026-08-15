import lionImage from '../assets/moca/images/lion.png'
import rhinoImage from '../assets/moca/images/rhino.png'
import camelImage from '../assets/moca/images/camel.png'

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
    scorerId: 'naming'
  },
  {
    id: 'digit-span-forward',
    section: 'Attention',
    instructionTextEn: 'Listen to the numbers, then repeat them in the same order.',
    instructionTextTh: 'ฟังตัวเลขต่อไปนี้ แล้วพูดทวนตามลำดับ',
    countdownSec: 0,
    timeLimitSec: 7,
    scorerId: 'digit-span-forward',
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
    // Patient hears "742" and must say it reversed: "247".
    expectedSequence: '247'
  },
  {
    id: 'orientation',
    section: 'Orientation',
    instructionTextEn: "Tell me today's day, month, year, date, place, and province.",
    instructionTextTh: 'บอกวัน เดือน ปี วันที่ สถานที่ และจังหวัดในวันนี้',
    countdownSec: 0,
    timeLimitSec: 15,
    scorerId: 'orientation'
  }
]
