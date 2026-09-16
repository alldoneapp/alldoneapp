import React from 'react'
import renderer, { act } from 'react-test-renderer'

import useTaskEditorLock, { createTaskEditorLock } from './useTaskEditorLock'

const mockDispatch = jest.fn()

jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch }))

function LockHarness({ active }) {
    useTaskEditorLock(active)
    return null
}

describe('createTaskEditorLock', () => {
    it('counts one active editor despite repeated opens and releases once', () => {
        const dispatch = jest.fn()
        const lock = createTaskEditorLock(dispatch)

        lock.acquire()
        lock.acquire()
        lock.release()
        lock.release()

        expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual(['Start task editor', 'Finish task editor'])
        expect(lock.isAcquired()).toBe(false)
    })

    it('holds an active editor lock through mount and releases it on unmount', () => {
        let tree

        act(() => {
            tree = renderer.create(<LockHarness active={true} />)
        })
        expect(mockDispatch.mock.calls.map(([action]) => action.type)).toEqual(['Start task editor'])

        act(() => tree.unmount())
        expect(mockDispatch.mock.calls.map(([action]) => action.type)).toEqual([
            'Start task editor',
            'Finish task editor',
        ])
    })

    it('does not acquire automatically for manually controlled add-task flows', () => {
        let tree

        act(() => {
            tree = renderer.create(<LockHarness active={false} />)
        })
        act(() => tree.unmount())

        expect(mockDispatch).not.toHaveBeenCalled()
    })

    beforeEach(() => jest.clearAllMocks())
})
