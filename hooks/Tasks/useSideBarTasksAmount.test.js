import React from 'react'
import { Provider } from 'react-redux'
import renderer, { act } from 'react-test-renderer'

const mockUpdateWorkstreamsUsersIdsByProject = jest.fn()
const mockWatcherController = { updateWorkstreamsUsersIdsByProject: mockUpdateWorkstreamsUsersIdsByProject }

jest.mock('../../utils/backends/Tasks/taskNumbers', () => ({
    watchSidebarTasksAmount: jest.fn(() => mockWatcherController),
    unwatchSidebarTasksAmount: jest.fn(),
    clearSidebarTasksAmount: jest.fn(),
}))

import {
    clearSidebarTasksAmount,
    unwatchSidebarTasksAmount,
    watchSidebarTasksAmount,
} from '../../utils/backends/Tasks/taskNumbers'
import useSideBarTasksAmount from './useSideBarTasksAmount'

const createStore = initialState => {
    let state = initialState
    const listeners = new Set()
    return {
        getState: () => state,
        dispatch: jest.fn(),
        subscribe: listener => {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
        setState: update => {
            state = { ...state, ...update }
            listeners.forEach(listener => listener())
        },
    }
}

const Harness = () => {
    useSideBarTasksAmount()
    return null
}

describe('useSideBarTasksAmount', () => {
    beforeEach(() => jest.clearAllMocks())

    it('updates workstream membership without recreating every task-count listener', () => {
        const store = createStore({
            loggedUserProjects: [{ id: 'p1' }],
            projectWorkstreams: { p1: [] },
        })
        let component

        act(() => {
            component = renderer.create(
                <Provider store={store}>
                    <Harness />
                </Provider>
            )
        })

        expect(watchSidebarTasksAmount).toHaveBeenCalledTimes(1)
        expect(unwatchSidebarTasksAmount).not.toHaveBeenCalled()

        act(() => {
            store.setState({
                projectWorkstreams: { p1: [{ uid: 'ws1', userIds: ['u1'] }] },
            })
        })

        expect(watchSidebarTasksAmount).toHaveBeenCalledTimes(1)
        expect(unwatchSidebarTasksAmount).not.toHaveBeenCalled()
        expect(mockUpdateWorkstreamsUsersIdsByProject).toHaveBeenLastCalledWith([[{ wsId: 'ws1', userIds: ['u1'] }]])

        act(() => {
            store.setState({
                loggedUserProjects: [{ id: 'p1' }, { id: 'p2' }],
                projectWorkstreams: { p1: [{ uid: 'ws1', userIds: ['u1'] }], p2: [] },
            })
        })

        expect(watchSidebarTasksAmount).toHaveBeenCalledTimes(2)
        expect(unwatchSidebarTasksAmount).toHaveBeenCalledTimes(1)
        expect(unwatchSidebarTasksAmount).toHaveBeenLastCalledWith(expect.any(Array), { clearNumbers: false })
        expect(clearSidebarTasksAmount).not.toHaveBeenCalled()

        act(() => component.unmount())

        expect(unwatchSidebarTasksAmount).toHaveBeenCalledTimes(2)
        expect(unwatchSidebarTasksAmount).toHaveBeenLastCalledWith(expect.any(Array), { clearNumbers: false })
        expect(clearSidebarTasksAmount).toHaveBeenCalledTimes(1)
    })
})
