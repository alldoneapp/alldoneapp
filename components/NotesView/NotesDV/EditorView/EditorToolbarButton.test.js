import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import EditorToolbarButton from './EditorToolbarButton'

describe('EditorToolbarButton', () => {
    let container
    let root

    beforeEach(() => {
        global.IS_REACT_ACT_ENVIRONMENT = true
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        delete global.IS_REACT_ACT_ENVIRONMENT
    })

    it('lets clicks from its visual content reach the native button action', () => {
        const onClick = jest.fn()

        act(() => {
            root.render(
                <EditorToolbarButton onClick={onClick}>
                    <span data-testid="toolbar-button-content">Task</span>
                </EditorToolbarButton>
            )
        })

        act(() => {
            container
                .querySelector('[data-testid="toolbar-button-content"]')
                .dispatchEvent(new MouseEvent('click', { bubbles: true }))
        })

        expect(onClick).toHaveBeenCalledTimes(1)
    })

    // A toolbar button that takes focus on press blurs the Quill editor and
    // kills the user's text selection before the action ever runs - which is
    // how "select text, press Task" stopped pre-filling the create-task popup.
    it('prevents the mousedown default so the editor keeps focus and selection', () => {
        act(() => {
            root.render(
                <EditorToolbarButton onClick={() => {}}>
                    <span data-testid="toolbar-button-content">Task</span>
                </EditorToolbarButton>
            )
        })

        const mouseDownEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
        act(() => {
            container.querySelector('[data-testid="toolbar-button-content"]').dispatchEvent(mouseDownEvent)
        })

        expect(mouseDownEvent.defaultPrevented).toBe(true)
    })

    it('still calls a caller-supplied onMouseDown', () => {
        const onMouseDown = jest.fn()

        act(() => {
            root.render(
                <EditorToolbarButton onMouseDown={onMouseDown}>
                    <span data-testid="toolbar-button-content">Task</span>
                </EditorToolbarButton>
            )
        })

        act(() => {
            container
                .querySelector('[data-testid="toolbar-button-content"]')
                .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
        })

        expect(onMouseDown).toHaveBeenCalledTimes(1)
    })
})
