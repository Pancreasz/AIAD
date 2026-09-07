import { scoreOrientation } from './orientation.js'
import { scoreNaming } from './naming.js'
import { scoreDigitSpan } from './digitSpan.js'
import { scoreMemoryRegistration, scoreDelayedRecall } from './memoryWords.js'
import { scoreSerialSevens } from './serialSevens.js'
import { scoreVigilance } from './vigilance.js'
import { scoreAbstraction } from './abstraction.js'
import { scoreSentenceRepetition } from './sentenceRepetition.js'
import { scoreVerbalFluency } from './verbalFluency.js'

export function scoreItem(subtestId, transcript, context) {
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
      // The only scorer whose answer is not speech: `transcript` is always ''
      // and the response arrives as tap offsets on the context.
      return scoreVigilance(context.taps, context)
    // Both items share one scorer, which needs to know which pair was asked:
    // the same accepted term must score one item and not the other.
    case 'abstraction-1':
    case 'abstraction-2':
      return scoreAbstraction(transcript, subtestId)
    // Both items share one scorer, which needs to know which sentence was
    // asked -- the same reason abstraction's dispatch carries subtestId.
    case 'sentence-repetition-1':
    case 'sentence-repetition-2':
      return scoreSentenceRepetition(transcript, subtestId)
    case 'verbal-fluency':
      return scoreVerbalFluency(transcript)
    default:
      throw new Error(`No scorer registered for subtest "${subtestId}"`)
  }
}
