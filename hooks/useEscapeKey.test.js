import React from 'react'
import renderer, { act } from 'react-test-renderer'

import useEscapeKey from './useEscapeKey'
import { getEscapeStackSize, installEscapeStack, resetEscapeStack } from '../utils/escapeStack'

const pressEscape = () => {
    act(() => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
}

function Popup({ onEscape, enabled, label }) {
    useEscapeKey(onEscape, enabled === undefined ? undefined : { enabled })
    return null
}

describe('useEscapeKey', () => {
    let uninstall

    beforeEach(() => {
        document.body.innerHTML = ''
        resetEscapeStack()
        uninstall = installEscapeStack()
    })

    afterEach(() => {
        uninstall()
        resetEscapeStack()
    })

    it('closes the popup on Escape', () => {
        const onEscape = jest.fn()
        act(() => {
            renderer.create(<Popup onEscape={onEscape} />)
        })

        pressEscape()

        expect(onEscape).toHaveBeenCalledTimes(1)
    })

    it('unregisters on unmount', () => {
        const onEscape = jest.fn()
        let tree
        act(() => {
            tree = renderer.create(<Popup onEscape={onEscape} />)
        })
        expect(getEscapeStackSize()).toBe(1)

        act(() => {
            tree.unmount()
        })

        expect(getEscapeStackSize()).toBe(0)
        pressEscape()
        expect(onEscape).not.toHaveBeenCalled()
    })

    it('gives the key to the popup that mounted last', () => {
        const modal = jest.fn()
        const picker = jest.fn()
        act(() => {
            renderer.create(<Popup onEscape={modal} label="modal" />)
        })
        let pickerTree
        act(() => {
            pickerTree = renderer.create(<Popup onEscape={picker} label="picker" />)
        })

        pressEscape()
        expect(picker).toHaveBeenCalledTimes(1)
        expect(modal).not.toHaveBeenCalled()

        act(() => {
            pickerTree.unmount()
        })
        pressEscape()
        expect(modal).toHaveBeenCalledTimes(1)
    })

    it('keeps its place in the stack across re-renders', () => {
        // The registration must NOT be repeated per render: the stack is LIFO, so
        // a modal that re-renders (they all do, constantly) would otherwise climb
        // back above the picker it opened and steal the picker's Escape.
        const modal = jest.fn()
        const picker = jest.fn()
        let modalTree
        act(() => {
            modalTree = renderer.create(<Popup onEscape={modal} label="modal" />)
        })
        act(() => {
            renderer.create(<Popup onEscape={picker} label="picker" />)
        })

        act(() => {
            modalTree.update(<Popup onEscape={modal} label="modal re-rendered" />)
        })

        pressEscape()

        expect(picker).toHaveBeenCalledTimes(1)
        expect(modal).not.toHaveBeenCalled()
        expect(getEscapeStackSize()).toBe(2)
    })

    it('always calls the latest callback, not the one captured at mount', () => {
        const first = jest.fn()
        const second = jest.fn()
        let tree
        act(() => {
            tree = renderer.create(<Popup onEscape={first} />)
        })
        act(() => {
            tree.update(<Popup onEscape={second} />)
        })

        pressEscape()

        expect(second).toHaveBeenCalledTimes(1)
        expect(first).not.toHaveBeenCalled()
    })

    it('goes inert while disabled, without giving up its place', () => {
        const modal = jest.fn()
        const picker = jest.fn()
        act(() => {
            renderer.create(<Popup onEscape={modal} />)
        })
        let pickerTree
        act(() => {
            pickerTree = renderer.create(<Popup onEscape={picker} enabled={false} />)
        })

        pressEscape()
        expect(picker).not.toHaveBeenCalled()
        expect(modal).toHaveBeenCalledTimes(1)

        act(() => {
            pickerTree.update(<Popup onEscape={picker} enabled={true} />)
        })
        pressEscape()
        expect(picker).toHaveBeenCalledTimes(1)
        expect(modal).toHaveBeenCalledTimes(1)
    })
})
