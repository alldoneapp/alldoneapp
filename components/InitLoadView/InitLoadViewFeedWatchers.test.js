/** @jest-environment jsdom */
import React from 'react'
import { Provider } from 'react-redux'
import { createStore } from 'redux'
import { act, create } from 'react-test-renderer'

import Backend from '../../utils/BackendBridge'
import InitLoadView from './InitLoadView'

jest.mock('../../utils/BackendBridge', () => ({
    __esModule: true,
    default: {
        watchAllNewFeedsAllTabs: jest.fn(),
        watchNewFeedsAllTabs: jest.fn(),
        unsubNewFeedsTab: jest.fn(),
    },
}))
jest.mock('../../hooks/useReachEmptyInbox', () => () => {})
jest.mock('../../hooks/useReachProjectEmptyInbox', () => () => {})
jest.mock('../../hooks/Tasks/useSideBarTasksAmount', () => () => {})
jest.mock('../../hooks/useDeferredStartupWork', () => () => true)
jest.mock('./SharedProjectsUnmountLogic', () => () => null)
jest.mock('./ObservedForWatchOutsideNewProjectsChats', () => () => null)
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {
        // Active = everything; guides = none. The component only needs the ids.
        getProjectsByType: (projects, user, type) => (type === 'active' ? [...projects] : []),
    },
    checkIfSelectedProject: index => index >= 0,
}))
jest.mock('../SettingsView/ProjectsSettings/ProjectsSettings', () => ({
    PROJECT_TYPE_ACTIVE: 'active',
    PROJECT_TYPE_GUIDE: 'guide',
    PROJECT_TYPE_SHARED: 'shared',
}))

const reducer = (state, action) => (action.type === 'patch' ? { ...state, ...action.patch } : state)
const initialState = {
    followedFeedsData: {},
    selectedTypeOfProject: 'active',
    loggedUser: { uid: 'user-1' },
    loggedUserProjects: [{ id: 'p1' }, { id: 'p2' }],
    selectedProjectIndex: -1,
}

const openProjectIds = () => Backend.watchAllNewFeedsAllTabs.mock.calls.map(([projects]) => projects.map(p => p.id))

describe('InitLoadView unread-badge listeners', () => {
    beforeEach(() => jest.clearAllMocks())

    it('keeps its listeners when the project documents change but the watched set does not', () => {
        const store = createStore(reducer, initialState)
        let tree
        act(() => {
            tree = create(
                <Provider store={store}>
                    <InitLoadView />
                </Provider>
            )
        })
        expect(openProjectIds()).toEqual([['p1', 'p2']])

        // Every project snapshot at boot replaces the array with equal contents.
        act(() =>
            store.dispatch({ type: 'patch', patch: { loggedUserProjects: [{ id: 'p1', name: 'x' }, { id: 'p2' }] } })
        )
        act(() =>
            store.dispatch({ type: 'patch', patch: { loggedUserProjects: [{ id: 'p1' }, { id: 'p2', name: 'y' }] } })
        )
        expect(Backend.watchAllNewFeedsAllTabs).toHaveBeenCalledTimes(1)
        expect(Backend.unsubNewFeedsTab).not.toHaveBeenCalled()

        act(() =>
            store.dispatch({ type: 'patch', patch: { loggedUserProjects: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] } })
        )
        expect(openProjectIds()).toEqual([
            ['p1', 'p2'],
            ['p1', 'p2', 'p3'],
        ])

        Backend.unsubNewFeedsTab.mockClear()
        act(() => tree.unmount())
        // Unmount closes the listeners that are open NOW, not the previous generation.
        const closed = Backend.unsubNewFeedsTab.mock.calls.map(([projectId, tab]) => `${projectId}:${tab}`)
        expect(closed.sort()).toEqual(['p1:all', 'p1:followed', 'p2:all', 'p2:followed', 'p3:all', 'p3:followed'])
    })
})
