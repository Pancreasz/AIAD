import { scoreOrientation } from './orientation.js'
import { scoreNaming } from './naming.js'
import { scoreDigitSpan } from './digitSpan.js'
import { scoreMemoryRegistration, scoreDelayedRecall } from './memoryWords.js'
import { scoreSerialSevens } from './serialSevens.js'
import { scoreVigilance } from './vigilance.js'
import { scoreAbstraction } from './abstraction.js'
import { scoreSentenceRepetition } from './sentenceRepetition.js'
import { scoreVerbalFluency } from './verbalFluency.js'
import { scoreTrailMaking, scoreCubeDrawing, scoreClockDrawing } from './drawing.js'

export async function scoreItem(subtestId, transcript, context) {
  switch (subtestId) {
    case 'orientation':
      return scoreOrientation(transcript, context)
    case 'naming':
      return scoreNaming(transcript)
    case 'digit-span-forward':
    case 'digit-span-backward':
      return scoreDigitSpan(transcript, context.expectedSequence)
    case 'memory-registration':
      return scoreMemoryRegistration(transcript)
    case 'delayed-recall':
      return scoreDelayedRecall(transcript)
    case 'serial-sevens':
      return scoreSerialSevens(transcript)
    case 'vigilance':
      return scoreVigilance(context.taps, context)
    case 'abstraction-1':
    case 'abstraction-2':
      return scoreAbstraction(transcript, subtestId)
    case 'sentence-repetition-1':
    case 'sentence-repetition-2':
      return scoreSentenceRepetition(transcript, subtestId)
    case 'verbal-fluency':
      return scoreVerbalFluency(transcript)
    case 'trail-making':
      return scoreTrailMaking(context)
    case 'cube-drawing':
      return scoreCubeDrawing(context)
    case 'clock-drawing':
      return scoreClockDrawing(context)
    default:
      throw new Error(`No scorer registered for subtest "${subtestId}"`)
  }
}
