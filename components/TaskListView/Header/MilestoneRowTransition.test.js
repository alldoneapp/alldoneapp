import React from 'react'
import renderer, { act } from 'react-test-renderer'
import MilestoneRowTransition, { MILESTONE_EXIT_MS } from './MilestoneRowTransition'
import { useReducedMotion } from '../../UIComponents/Ghosts/ghostAnimation'

jest.mock('../../UIComponents/Ghosts/ghostAnimation', () => ({ useReducedMotion: jest.fn(() => false) }))

const row = id => <MilestoneRowTransition milestoneId={id}>{id ? <span>{id}</span> : null}</MilestoneRowTransition>

describe('milestone departure', () => {
    let tree
    beforeEach(() => {
        jest.useFakeTimers()
        useReducedMotion.mockReturnValue(false)
    })
    afterEach(() => {
        act(() => tree?.unmount())
        jest.useRealTimers()
    })
    const mount = id =>
        act(() => {
            tree = renderer.create(row(id))
        })
    const update = id => act(() => tree.update(row(id)))
    const advance = () => act(() => jest.advanceTimersByTime(MILESTONE_EXIT_MS))
    const label = () => tree.root.findByType('span').props.children

    it('retains the removed milestone until its exit finishes, without relying on an animation callback', () => {
        mount('first')
        update(null)
        expect(label()).toBe('first')
        advance()
        expect(tree.toJSON()).toBeNull()
    })

    it('reveals the following milestone after the previous one leaves', () => {
        mount('first')
        update('second')
        expect(label()).toBe('first')
        advance()
        expect(label()).toBe('second')
        update(null)
        expect(label()).toBe('second')
        advance()
        expect(tree.toJSON()).toBeNull()
    })

    it('cancels removal when the milestone returns', () => {
        mount('first')
        update(null)
        update('first')
        advance()
        expect(label()).toBe('first')
        expect(tree.root.findByProps({ testID: 'milestone-row-transition' }).props.style).toBe(false)
    })

    it('shows initial data immediately and skips the hold for reduced motion', () => {
        mount(null)
        update('first')
        expect(label()).toBe('first')
        useReducedMotion.mockReturnValue(true)
        update(null)
        expect(tree.toJSON()).toBeNull()
    })
})
