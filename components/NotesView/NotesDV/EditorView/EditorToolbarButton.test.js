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
})
