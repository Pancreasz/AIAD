import { scoreOrientation } from './orientation.js'
import { scoreNaming } from './naming.js'
import { scoreDigitSpan } from './digitSpan.js'

export function scoreItem(subtestId, transcript, context) {
  switch (subtestId) {
    case 'orientation':
      return scoreOrientation(transcript, context)
    case 'naming':
      return scoreNaming(transcript)
    case 'digit-span-forward':
    case 'digit-span-backward':
      return scoreDigitSpan(transcript, context.expectedSequence)
    default:
      throw new Error(`No scorer registered for subtest "${subtestId}"`)
  }
}
