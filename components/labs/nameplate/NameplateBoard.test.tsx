import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import NameplateBoard from './NameplateBoard'
import { NameplateData } from './types'
import { updateNameplatePosition } from './api'

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    getToken: vi.fn(() => 'owner-token'),
    updateNameplatePosition: vi.fn(),
  }
})

describe('NameplateBoard drag persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists latest drag position on immediate mouseup', () => {
    const plate: NameplateData = {
      id: 'plate-1',
      name: 'Jeff',
      theme: 'portfolio',
      font: 'default',
      effect: 'solid',
      createdAt: new Date().toISOString(),
      visitorToken: 'owner-token',
      x: 100,
      y: 100,
      rotation: 0,
    }

    const { container } = render(<NameplateBoard plates={[plate]} />)
    const nameNode = screen.getByText('Jeff')
    const draggable = nameNode.closest('.absolute') as HTMLElement | null
    expect(draggable).not.toBeNull()

    fireEvent.mouseDown(draggable as HTMLElement, { clientX: 10, clientY: 10 })

    // Keep move+up in one act block to simulate a very fast drag where React
    // has not committed a re-render between events.
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 35, bubbles: true }))
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })

    expect(updateNameplatePosition).toHaveBeenCalledTimes(1)
    expect(updateNameplatePosition).toHaveBeenCalledWith('plate-1', {
      x: 150,
      y: 125,
      rotation: 0,
    })

    expect(container.querySelector('[data-dragging="true"]')).toBeNull()
  })

  it('does not persist position on click without mousemove', () => {
    const plate: NameplateData = {
      id: 'plate-2',
      name: 'Sam',
      theme: 'portfolio',
      font: 'default',
      effect: 'solid',
      createdAt: new Date().toISOString(),
      visitorToken: 'owner-token',
      x: 220,
      y: 180,
      rotation: 3,
    }

    const { container } = render(<NameplateBoard plates={[plate]} />)
    const nameNode = screen.getByText('Sam')
    const draggable = nameNode.closest('.absolute') as HTMLElement | null
    expect(draggable).not.toBeNull()

    fireEvent.mouseDown(draggable as HTMLElement, { clientX: 40, clientY: 30 })
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })

    expect(updateNameplatePosition).not.toHaveBeenCalled()
    expect(container.querySelector('[data-dragging="true"]')).toBeNull()
  })
})
