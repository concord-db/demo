import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PipelineExplorer } from './PipelineExplorer'

const stages = [
  { name: 'Input', short: 'clips', detail: 'Read two cameras.' },
  { name: 'Detect', short: 'boxes', detail: 'Find vehicles.' },
]

describe('PipelineExplorer', () => {
  it('navigates to the next recorded operator', () => {
    const onChange = vi.fn()
    render(
      <PipelineExplorer
        stages={stages}
        active={0}
        onChange={onChange}
        onRun={vi.fn()}
        running={false}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(onChange).toHaveBeenCalledWith(1)
  })

  it('announces the active stage', () => {
    render(
      <PipelineExplorer
        stages={stages}
        active={1}
        onChange={vi.fn()}
        onRun={vi.fn()}
        running={false}
      />,
    )
    expect(screen.getByRole('listitem', { name: /detect/i })).toHaveAttribute(
      'aria-current',
      'step',
    )
  })
})
