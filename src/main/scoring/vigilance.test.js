import { describe, it, expect } from 'vitest'
import { scoreVigilance } from './vigilance.js'

// A short stand-in sequence keeps the arithmetic checkable by eye. The real
// 29-digit sequence is exercised through subtests.test.js instead.
//            index: 0    1    2    3    4
//                   5    1    3    1    9
const SEQUENCE = '51319'
const OPTIONS = { sequence: SEQUENCE, target: '1', intervalMs: 1000 }

// Mid-window, so a tap is unambiguous about which digit it belongs to.
const inWindow = (index) => index * 1000 + 500

describe('scoreVigilance', () => {
  it('scores 1 when every target is tapped and nothing else is', () => {
    const result = scoreVigilance([inWindow(1), inWindow(3)], OPTIONS)
    expect(result).toMatchObject({ score: 1, maxScore: 1, hits: 2, misses: 0, falseTaps: 0, errors: 0 })
  })

  it('still scores 1 with a single missed target, since the rule allows one error', () => {
    const result = scoreVigilance([inWindow(1)], OPTIONS)
    expect(result).toMatchObject({ score: 1, misses: 1, errors: 1 })
  })

  it('scores 0 once there are two errors', () => {
    const result = scoreVigilance([], OPTIONS)
    expect(result).toMatchObject({ score: 0, hits: 0, misses: 2, errors: 2 })
  })

  it('counts a tap on a non-target digit as a false tap', () => {
    const result = scoreVigilance([inWindow(1), inWindow(3), inWindow(4)], OPTIONS)
    expect(result).toMatchObject({ score: 1, hits: 2, falseTaps: 1, errors: 1 })
  })

  it('scores 0 for one miss plus one false tap', () => {
    const result = scoreVigilance([inWindow(1), inWindow(0)], OPTIONS)
    expect(result).toMatchObject({ score: 0, misses: 1, falseTaps: 1, errors: 2 })
  })

  // The instrument counts errors per digit, not per hand movement: a patient
  // who double-taps one target has made one mistake about one digit.
  it('counts two taps inside one window as a single event', () => {
    const result = scoreVigilance([inWindow(1), inWindow(1) + 100, inWindow(3)], OPTIONS)
    expect(result).toMatchObject({ score: 1, hits: 2, falseTaps: 0, errors: 0 })
  })

  // The deliberate cost of strict windows, locked in so it can never change
  // silently: a reaction slower than the interval is charged twice.
  it('charges a late tap as both a miss and a false tap', () => {
    const result = scoreVigilance([1000 + 1100], OPTIONS)
    expect(result).toMatchObject({ score: 0, hits: 0, misses: 2, falseTaps: 1, errors: 3 })
  })

  it('ignores taps that land before the first digit or after the last window', () => {
    const result = scoreVigilance([-200, inWindow(1), inWindow(3), 5 * 1000 + 10], OPTIONS)
    expect(result).toMatchObject({ score: 1, hits: 2, falseTaps: 0, errors: 0 })
  })

  it('measures each latency from its own target onset, not from the sequence start', () => {
    const result = scoreVigilance([1000 + 420, 3000 + 610], OPTIONS)
    expect(result.tapLatencies).toEqual([420, 610])
  })

  it('reports latency for the first tap in a window when there are several', () => {
    const result = scoreVigilance([1000 + 300, 1000 + 800, 3000 + 500], OPTIONS)
    expect(result.tapLatencies).toEqual([300, 500])
  })

  it('treats a missing tap list as no taps rather than throwing', () => {
    expect(scoreVigilance(undefined, OPTIONS)).toMatchObject({ hits: 0, misses: 2 })
  })
})
