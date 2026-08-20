import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import useLoadingMore, { LOADING_MORE_TIMEOUT_MS } from './useLoadingMore'

const Probe = ({ signal, onReady }) => {
    const [loadingMore, startLoadingMore] = useLoadingMore(signal)
    onReady(startLoadingMore)
    return <Text testID="state">{loadingMore ? 'loading' : 'idle'}</Text>
}

const readState = tree => tree.root.findByProps({ testID: 'state' }).props.children

describe('useLoadingMore', () => {
    let start

    const mount = signal => {
        let tree
        act(() => {
            tree = renderer.create(<Probe signal={signal} onReady={fn => (start = fn)} />)
        })
        return tree
    }

    const update = (tree, signal) => {
        act(() => {
            tree.update(<Probe signal={signal} onReady={fn => (start = fn)} />)
        })
    }

    beforeEach(() => {
        jest.useFakeTimers()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('starts idle and does not arm itself on mount', () => {
        const tree = mount({ a: 1 })
        expect(readState(tree)).toBe('idle')
    })

    it('stays armed across its own re-render, and only the NEXT delivery clears it', () => {
        const first = { a: 1 }
        const tree = mount(first)

        act(() => start())
        // The press handler and the re-render it causes must not be mistaken for a delivery:
        // the signal has not changed, so the ghosts have to survive this render.
        expect(readState(tree)).toBe('loading')

        update(tree, first)
        expect(readState(tree)).toBe('loading')

        update(tree, { a: 1, b: 2 })
        expect(readState(tree)).toBe('idle')
    })

    it('clears on a delivery that is equal in value but new in identity', () => {
        const tree = mount([])
        act(() => start())
        expect(readState(tree)).toBe('loading')

        // The page came back empty. A length or deep-value comparison would see no change
        // and ghost forever; identity is what makes this terminate.
        update(tree, [])
        expect(readState(tree)).toBe('idle')
    })

    it('documents the trap: a signal rebuilt on every render clears immediately', () => {
        // This is not desired behaviour, it is the contract. `useGetMessages` returns
        // `[...state.messages]` — a new array per render — so ChatBoard deliberately passes
        // a derived string instead. Pass an unstable signal and the ghosts flash for one
        // frame, which is worse than showing none.
        const tree = mount([1, 2])
        act(() => start())
        expect(readState(tree)).toBe('loading')

        update(tree, [1, 2]) // same contents, fresh array — as an unstable caller would do
        expect(readState(tree)).toBe('idle')
    })

    it('gives up after the timeout when no delivery ever arrives', () => {
        const tree = mount({ a: 1 })
        act(() => start())
        expect(readState(tree)).toBe('loading')

        act(() => {
            jest.advanceTimersByTime(LOADING_MORE_TIMEOUT_MS)
        })

        expect(readState(tree)).toBe('idle')
    })

    it('does not leave a timer running once a delivery clears it', () => {
        const tree = mount({ a: 1 })
        act(() => start())
        update(tree, { a: 2 })
        expect(readState(tree)).toBe('idle')

        act(() => {
            jest.advanceTimersByTime(LOADING_MORE_TIMEOUT_MS * 2)
        })

        expect(readState(tree)).toBe('idle')
    })
})
