import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SessionResults } from './SessionResults.jsx'

const subtests = [
  { id: 'naming', section: 'Naming' },
  { id: 'orientation', section: 'Orientation' },
  { id: 'memory-registration-1', section: 'Memory (trial 1)' },
  { id: 'memory-registration-2', section: 'Memory (trial 2)' },
  { id: 'delayed-recall', section: 'Delayed Recall' }
]

describe('SessionResults', () => {
  it('renders each subtest score and the total', () => {
    const results = [
      { subtestId: 'naming', score: 2, maxScore: 3, engine: 'local' },
      { subtestId: 'orientation', score: 6, maxScore: 6, engine: 'openai' }
    ]
    render(<SessionResults results={results} subtests={subtests} />)

    expect(screen.getByText('Naming')).toBeInTheDocument()
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    expect(screen.getByText('Orientation')).toBeInTheDocument()
    expect(screen.getByText('6 / 6')).toBeInTheDocument()
    expect(screen.getByText('Total: 8 / 9')).toBeInTheDocument()
  })

  it('names the engine that produced each transcript', () => {
    const results = [
      { subtestId: 'naming', score: 2, maxScore: 3, engine: 'local' },
      { subtestId: 'orientation', score: 6, maxScore: 6, engine: 'openai' }
    ]
    render(<SessionResults results={results} subtests={subtests} />)

    expect(screen.getByText('local')).toBeInTheDocument()
    expect(screen.getByText('openai')).toBeInTheDocument()
  })

  it('falls back to a dash when a result carries no engine', () => {
    const results = [{ subtestId: 'naming', score: 1, maxScore: 3 }]
    render(<SessionResults results={results} subtests={subtests} />)

    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

describe('SessionResults process data', () => {
  const tapSubtests = [
    { id: 'vigilance', section: 'Attention' },
    { id: 'naming', section: 'Naming' }
  ]

  const vigilance = {
    subtestId: 'vigilance',
    score: 1,
    maxScore: 1,
    engine: null,
    hits: 11,
    misses: 0,
    falseTaps: 0,
    errors: 0,
    tapLatencies: [400, 420, 380]
  }

  // The point alone cannot distinguish a patient who tracked every digit from
  // one who tapped twice and got lucky, and this is the subtest that produces
  // the only clean reaction-time data in the app.
  it('reports the tap counts and mean reaction time for a tap subtest', () => {
    render(<SessionResults results={[vigilance]} subtests={tapSubtests} />)

    expect(
      screen.getByText('11 hits, 0 misses, 0 false taps · 400 ms mean')
    ).toBeInTheDocument()
  })

  it('omits the mean when no target was ever hit, rather than printing NaN', () => {
    const missedEverything = {
      ...vigilance,
      score: 0,
      hits: 0,
      misses: 11,
      errors: 11,
      tapLatencies: []
    }
    render(<SessionResults results={[missedEverything]} subtests={tapSubtests} />)

    expect(screen.getByText('0 hits, 11 misses, 0 false taps')).toBeInTheDocument()
  })

  it('leaves the process cell empty for subtests that produce none', () => {
    const results = [{ subtestId: 'naming', score: 2, maxScore: 3, engine: 'local' }]
    const { container } = render(<SessionResults results={results} subtests={tapSubtests} />)

    const cells = container.querySelectorAll('tbody tr td')
    expect(cells).toHaveLength(4)
    expect(cells[3].textContent).toBe('')
  })
})

describe('SessionResults memory rows and recall interval', () => {
  const registration = {
    subtestId: 'memory-registration-2',
    score: 0,
    maxScore: 0,
    recalledCount: 3,
    engine: 'local',
    completedAt: 1_000_000
  }
  const recall = {
    subtestId: 'delayed-recall',
    score: 4,
    maxScore: 5,
    recalledCount: 4,
    engine: 'local',
    completedAt: 1_000_000 + 160_000 // 2m 40s later
  }

  it('shows the recalled count instead of a score for unscored rows', () => {
    render(<SessionResults results={[registration]} subtests={subtests} />)
    expect(screen.getByText('3 of 5 recalled')).toBeInTheDocument()
  })

  it('excludes unscored rows from the total', () => {
    render(<SessionResults results={[registration, recall]} subtests={subtests} />)
    // Only the recall contributes: 4 / 5, not 4 / 5 plus a 0 / 0 row.
    expect(screen.getByText('Total: 4 / 5')).toBeInTheDocument()
  })

  it('reports how long after registration the recall happened', () => {
    render(<SessionResults results={[registration, recall]} subtests={subtests} />)
    expect(screen.getByText(/Delayed recall after 2m 40s/)).toBeInTheDocument()
  })

  it('warns when the interval is under the five minute protocol gap', () => {
    render(<SessionResults results={[registration, recall]} subtests={subtests} />)
    expect(screen.getByText(/under the 5 minute protocol interval/)).toBeInTheDocument()
  })

  it('omits the interval entirely when registration or recall is missing', () => {
    render(<SessionResults results={[recall]} subtests={subtests} />)
    expect(screen.queryByText(/Delayed recall after/)).not.toBeInTheDocument()
  })

  it('does not warn when the interval meets the protocol gap', () => {
    const lateRecall = { ...recall, completedAt: 1_000_000 + 400_000 } // 6m 40s
    render(<SessionResults results={[registration, lateRecall]} subtests={subtests} />)
    expect(screen.getByText(/Delayed recall after 6m 40s/)).toBeInTheDocument()
    expect(screen.queryByText(/under the 5 minute/)).not.toBeInTheDocument()
  })
})

describe('SessionResults skipped subtests', () => {
  const skipped = {
    subtestId: 'naming',
    skipped: true,
    score: 0,
    maxScore: 0,
    completedAt: 1_000_000
  }
  const scored = { subtestId: 'orientation', score: 6, maxScore: 6, engine: 'local' }

  it('labels a skipped row rather than showing a score', () => {
    render(<SessionResults results={[skipped]} subtests={subtests} />)
    expect(screen.getByText('skipped')).toBeInTheDocument()
  })

  it('warns that the total is incomplete when anything was skipped', () => {
    render(<SessionResults results={[skipped, scored]} subtests={subtests} />)
    expect(screen.getByText(/1 subtest not administered/)).toBeInTheDocument()
    expect(screen.getByText(/this total is incomplete/)).toBeInTheDocument()
  })

  it('says nothing about skipping when every subtest ran', () => {
    render(<SessionResults results={[scored]} subtests={subtests} />)
    expect(screen.queryByText(/subtest not administered/)).not.toBeInTheDocument()
  })

  it('does not fabricate a recall interval when the recall was skipped', () => {
    const registration = {
      subtestId: 'memory-registration-2',
      score: 0,
      maxScore: 0,
      recalledCount: 3,
      engine: 'local',
      completedAt: 1_000_000
    }
    const skippedRecall = {
      subtestId: 'delayed-recall',
      skipped: true,
      score: 0,
      maxScore: 0,
      completedAt: 1_000_000 + 160_000
    }
    render(<SessionResults results={[registration, skippedRecall]} subtests={subtests} />)
    expect(screen.queryByText(/Delayed recall after/)).not.toBeInTheDocument()
  })

  it('does not fabricate a recall interval when registration was skipped', () => {
    const skippedRegistration = {
      subtestId: 'memory-registration-2',
      skipped: true,
      score: 0,
      maxScore: 0,
      completedAt: 1_000_000
    }
    const recall = {
      subtestId: 'delayed-recall',
      score: 4,
      maxScore: 5,
      recalledCount: 4,
      engine: 'local',
      completedAt: 1_000_000 + 160_000
    }
    render(<SessionResults results={[skippedRegistration, recall]} subtests={subtests} />)
    expect(screen.queryByText(/Delayed recall after/)).not.toBeInTheDocument()
  })

  it('adds a skipped row to neither side of the total', () => {
    // Registration ran (so the recall row is scorable and this test stays
    // focused on the unrelated skipped-naming-row exclusion).
    const registration = {
      subtestId: 'memory-registration-2',
      score: 0,
      maxScore: 0,
      recalledCount: 4,
      engine: 'local'
    }
    const recall = { subtestId: 'delayed-recall', score: 4, maxScore: 5 }
    const orientation = { subtestId: 'orientation', score: 6, maxScore: 6 }
    render(
      <SessionResults results={[skipped, registration, recall, orientation]} subtests={subtests} />
    )
    expect(screen.getByText('Total: 10 / 11')).toBeInTheDocument()
  })
})

describe('SessionResults recall scorability', () => {
  const skippedTrial1 = {
    subtestId: 'memory-registration-1',
    skipped: true,
    score: 0,
    maxScore: 0,
    completedAt: 1_000_000
  }
  const skippedTrial2 = {
    subtestId: 'memory-registration-2',
    skipped: true,
    score: 0,
    maxScore: 0,
    completedAt: 1_000_100
  }
  const recall = {
    subtestId: 'delayed-recall',
    score: 4,
    maxScore: 5,
    recalledCount: 4,
    engine: 'local',
    completedAt: 1_000_200
  }
  const orientation = { subtestId: 'orientation', score: 6, maxScore: 6, engine: 'local' }

  it('marks recall not scorable when both registration trials were skipped', () => {
    render(
      <SessionResults
        results={[skippedTrial1, skippedTrial2, recall, orientation]}
        subtests={subtests}
      />
    )
    expect(screen.getByText('not scorable — words never presented')).toBeInTheDocument()
    expect(screen.queryByText('4 / 5')).not.toBeInTheDocument()
  })

  it('excludes the unscorable recall row from both sides of the total', () => {
    render(
      <SessionResults
        results={[skippedTrial1, skippedTrial2, recall, orientation]}
        subtests={subtests}
      />
    )
    // Only orientation contributes: the recall's 4/5 must not be folded in,
    // because the patient was never played the words.
    expect(screen.getByText('Total: 6 / 6')).toBeInTheDocument()
  })

  it('scores recall normally when only one registration trial was skipped', () => {
    const ranTrial2 = {
      subtestId: 'memory-registration-2',
      score: 0,
      maxScore: 0,
      recalledCount: 3,
      engine: 'local',
      completedAt: 1_000_100
    }
    render(
      <SessionResults results={[skippedTrial1, ranTrial2, recall, orientation]} subtests={subtests} />
    )
    // Trial 2 actually ran, so the patient did encode the words -- recall
    // stands even though one exposure instead of two is a norms deviation.
    expect(screen.getByText('4 / 5')).toBeInTheDocument()
    expect(screen.getByText('Total: 10 / 11')).toBeInTheDocument()
  })
})
