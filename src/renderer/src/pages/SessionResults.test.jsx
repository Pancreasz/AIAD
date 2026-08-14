import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SessionResults } from './SessionResults.jsx'

const subtests = [
  { id: 'naming', section: 'Naming' },
  { id: 'orientation', section: 'Orientation' }
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
