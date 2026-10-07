import React, { useLayoutEffect } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'

import AppPopover from './AppPopover'
import { setWorkspaceViewport } from '../../../utils/workspaceViewport'

describe('AppPopover add-task reopen lifecycle (AT-2660)', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        window.matchMedia = jest.fn(() => ({ matches: true, addListener() {}, removeListener() {} }))
        jest.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
            top: 100,
            left: 100,
            right: 200,
            bottom: 140,
            width: 100,
            height: 40,
        })
    })

    afterEach(() => {
        setWorkspaceViewport(null)
        jest.useRealTimers()
        jest.restoreAllMocks()
        delete window.matchMedia
    })

    it('does not revive a closing portal when the workspace resizes during its fade', () => {
        window.innerWidth = 1440
        window.innerHeight = 900
        setWorkspaceViewport({ top: 72, left: 520, width: 920, height: 828 })
        const popup = isOpen => (
            <AppPopover isOpen={isOpen} content={<input data-testid="closing-editor" />}>
                <button>Open</button>
            </AppPopover>
        )
        const view = render(popup(true))
        expect(screen.getByTestId('closing-editor').isConnected).toBe(true)
        view.rerender(popup(false))
        act(() => setWorkspaceViewport({ top: 72, left: 620, width: 820, height: 828 }))
        for (let tick = 0; tick < 10; tick++) act(() => jest.advanceTimersByTime(100))
        expect(screen.queryByTestId('closing-editor')).toBeNull()
        expect(document.querySelector('.react-tiny-popover-container')).toBeNull()
        view.rerender(popup(true))
        expect(screen.getByTestId('closing-editor').isConnected).toBe(true)
        view.unmount()
    })

    it.each([1280, 390])('attaches the popup before mounting an editor on every open at %spx', width => {
        window.innerWidth = width
        window.innerHeight = 900
        const connectedAtMount = []
        function Editor() {
            useLayoutEffect(() => {
                // CustomTextInput3 resolves its Quill nodes through document.
                connectedAtMount.push(!!document.querySelector('[data-testid="editor"]'))
            }, [])
            return <input data-testid="editor" />
        }
        function Harness() {
            const [isOpen, setIsOpen] = React.useState(false)
            return (
                <AppPopover
                    isOpen={isOpen}
                    onClickOutside={() => setIsOpen(false)}
                    content={
                        <>
                            <Editor />
                            <button onClick={() => setIsOpen(false)}>Close</button>
                        </>
                    }
                    position={['bottom']}
                >
                    <button onClick={() => setIsOpen(true)}>Add task</button>
                </AppPopover>
            )
        }

        const view = render(<Harness />)
        for (let index = 0; index < 3; index++) {
            fireEvent.click(screen.getByText('Add task'))
            fireEvent.click(screen.getByText('Add task'))
            for (let tick = 0; tick < 5; tick++) act(() => jest.advanceTimersByTime(100))
            expect(screen.getByTestId('editor').isConnected).toBe(true)
            fireEvent.click(screen.getByText('Close'))
            for (let tick = 0; tick < 10; tick++) act(() => jest.advanceTimersByTime(100))
            expect(screen.queryByTestId('editor')).toBeNull()
        }
        expect(connectedAtMount).toEqual([true, true, true])
        view.unmount()
    })

    it('preserves the active draft when reopened during the sheet exit animation', () => {
        window.innerWidth = 390
        const connectedAtMount = jest.fn()
        function Editor() {
            const [draft, setDraft] = React.useState('')
            useLayoutEffect(() => {
                connectedAtMount(document.querySelector('[data-testid="editor"]').isConnected)
            }, [])
            return <input data-testid="editor" value={draft} onChange={event => setDraft(event.target.value)} />
        }
        const popup = isOpen => (
            <AppPopover isOpen={isOpen} content={<Editor />}>
                <button>Add task</button>
            </AppPopover>
        )
        const view = render(popup(true))
        const input = screen.getByTestId('editor')
        fireEvent.change(input, { target: { value: 'Keep my draft' } })

        view.rerender(popup(false))
        view.rerender(popup(true))
        for (let tick = 0; tick < 10; tick++) act(() => jest.advanceTimersByTime(100))

        expect(screen.getByTestId('editor')).toBe(input)
        expect(input.value).toBe('Keep my draft')
        expect(connectedAtMount).toHaveBeenCalledTimes(1)
        expect(connectedAtMount).toHaveBeenCalledWith(true)
        view.unmount()
    })
})
