import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import WorkspaceModal from './WorkspaceModal'
import { setWorkspaceViewport } from '../../../utils/workspaceViewport'

afterEach(() => {
    cleanup()
    setWorkspaceViewport(null)
})

it('keeps a standalone dialog and its draft mounted through zoom and resize, and closes on Escape', () => {
    const close = jest.fn()
    const view = render(
        <div style={{ overflow: 'hidden' }}>
            <WorkspaceModal visible onRequestClose={close}>
                <input aria-label="Copy contact draft" defaultValue="New contact" />
            </WorkspaceModal>
        </div>
    )
    const field = screen.getByLabelText('Copy contact draft')
    fireEvent.change(field, { target: { value: 'Keep this name' } })
    const dialog = screen.getByRole('dialog')
    expect(view.container.contains(dialog)).toBe(false)
    act(() => setWorkspaceViewport({ left: 520, top: 72, width: 920, height: 828 }))
    expect(screen.getByLabelText('Copy contact draft')).toBe(field)
    act(() => setWorkspaceViewport({ left: 700, top: 72, width: 740, height: 828 }))
    act(() => setWorkspaceViewport(null))
    expect(screen.getByLabelText('Copy contact draft')).toBe(field)
    expect(field.value).toBe('Keep this name')
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(close).toHaveBeenCalledTimes(1)
})
