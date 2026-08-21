import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import useProgressiveReveal, { PROGRESSIVE_REVEAL_TIMEOUT_MS } from './useProgressiveReveal'

const createManualScheduler = () => {
    const pending = []
    const schedule = callback => {
        const entry = { callback, cancelled: false }
        pending.push(entry)
        return () => {
            entry.cancelled = true
        }
    }
    schedule.flush = () => {
        const runnable = pending.filter(entry => !entry.cancelled)
        pending.length = 0
        runnable.forEach(entry => entry.callback())
    }
    return schedule
}

let api

const Probe = props => {
    api = useProgressiveReveal(props.totalCount, props)
    return <Text>{`${api.visibleAmount}|${api.complete ? 'complete' : 'revealing'}`}</Text>
}

describe('useProgressiveReveal', () => {
    let schedule

    const mount = (props = {}) => {
        schedule = props.schedule || createManualScheduler()
        const merged = {
            totalCount: 8,
            initialAmount: 2,
            batchSize: 2,
            resetKey: 'first-list',
            ...props,
            schedule,
        }
        let tree
        act(() => {
            tree = renderer.create(<Probe {...merged} />)
        })
        return { tree, props: merged }
    }

    beforeEach(() => {
        jest.useFakeTimers()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('mounts only the initial batch, then reveals one batch per paint', () => {
        mount()

        expect(api).toEqual({ visibleAmount: 2, complete: false })

        act(() => schedule.flush())
        expect(api).toEqual({ visibleAmount: 4, complete: false })

        act(() => schedule.flush())
        expect(api).toEqual({ visibleAmount: 6, complete: false })

        act(() => schedule.flush())
        expect(api).toEqual({ visibleAmount: 8, complete: true })
    })

    it('never reveals past the available item count', () => {
        mount({ totalCount: 5 })

        act(() => schedule.flush())
        act(() => schedule.flush())

        expect(api).toEqual({ visibleAmount: 5, complete: true })
    })

    it('starts from the initial batch immediately when the list changes', () => {
        const { tree, props } = mount()
        act(() => schedule.flush())
        expect(api.visibleAmount).toBe(4)

        act(() => {
            tree.update(<Probe {...props} resetKey="second-list" />)
        })

        expect(api.visibleAmount).toBe(2)
        expect(api.complete).toBe(false)
    })

    it('uses the timer backstop when animation frames do not run', () => {
        mount()

        act(() => jest.advanceTimersByTime(PROGRESSIVE_REVEAL_TIMEOUT_MS))

        expect(api.visibleAmount).toBe(4)
    })
})
