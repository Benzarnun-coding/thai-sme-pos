import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useState } from 'react'

function Counter() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>
}

describe('Simple Test', () => {
  it('renders counter', () => {
    render(<Counter />)
    expect(screen.getByRole('button')).toHaveTextContent('0')
  })
})
