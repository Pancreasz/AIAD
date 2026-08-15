import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SessionResults } from './SessionResults.jsx'

const subtests = [
  { id: 'naming', section: 'Naming' },
  { id: 'orientation', section: 'Orientation' },
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
    expect(screen.getByText(/1 subtest skipped/)).toBeInTheDocument()
  })

  it('says nothing about skipping when every subtest ran', () => {
    render(<SessionResults results={[scored]} subtests={subtests} />)
    expect(screen.queryByText(/subtest skipped/)).not.toBeInTheDocument()
  })
})
