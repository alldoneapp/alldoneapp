/** @jest-environment jsdom */
import React from 'react'
import { Provider } from 'react-redux'
import { createStore } from 'redux'
import { reduxBatch } from '@manaflair/redux-batch'
import { act, create } from 'react-test-renderer'

import Backend from '../../utils/BackendBridge'
import InitLoadView from './InitLoadView'
import { selectNewFeeds } from '../../utils/backends/Feeds/newFeedsHelper'

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
        getGlobalFeedProjects: (...args) =>
            jest.requireActual('../SettingsView/ProjectsSettings/ProjectHelper').default.getGlobalFeedProjects(...args),
    },
}))
jest.mock('../SettingsView/ProjectsSettings/ProjectsSettings', () => ({
    PROJECT_TYPE_ACTIVE: 'active',
    PROJECT_TYPE_GUIDE: 'guide',
    PROJECT_TYPE_SHARED: 'shared',
}))

const reducer = (state, action) => {
    if (Array.isArray(action)) return action.reduce(reducer, state)
    if (action.type === 'patch') return { ...state, ...action.patch }
    const fields = {
        'Set followed feeds amount': 'followedFeedsAmount',
        'Set all feeds amount': 'allFeedsAmount',
        'Set followed feeds data': 'followedFeedsData',
        'Set all feeds data': 'allFeedsData',
    }
    const field = fields[action.type]
    return field ? { ...state, [field]: action[field] } : state
}
const initialState = {
    followedFeedsData: {},
    selectedTypeOfProject: 'active',
    loggedUser: {
        uid: 'user-1',
        projectIds: ['p1', 'p2', 'p3'],
        guideProjectIds: [],
        archivedProjectIds: [],
        templateProjectIds: [],
    },
    loggedUserProjects: [
        { userIds: ['user-1'], id: 'p1' },
        { userIds: ['user-1'], id: 'p2' },
    ],
    selectedProjectIndex: -1,
}

const openProjectIds = () => Backend.watchAllNewFeedsAllTabs.mock.calls.map(([projects]) => projects.map(p => p.id))

describe('InitLoadView unread-badge listeners', () => {
    beforeEach(() => jest.clearAllMocks())

    it('keeps its listeners when the project documents change but the watched set does not', () => {
        const store = createStore(reducer, initialState, reduxBatch)
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
            store.dispatch({
                type: 'patch',
                patch: {
                    loggedUserProjects: [
                        { userIds: ['user-1'], id: 'p1', name: 'x' },
                        { userIds: ['user-1'], id: 'p2' },
                    ],
                },
            })
        )
        act(() =>
            store.dispatch({
                type: 'patch',
                patch: {
                    loggedUserProjects: [
                        { userIds: ['user-1'], id: 'p1' },
                        { userIds: ['user-1'], id: 'p2', name: 'y' },
                    ],
                },
            })
        )
        expect(Backend.watchAllNewFeedsAllTabs).toHaveBeenCalledTimes(1)
        expect(Backend.unsubNewFeedsTab).not.toHaveBeenCalled()

        act(() =>
            store.dispatch({
                type: 'patch',
                patch: {
                    loggedUserProjects: [
                        { userIds: ['user-1'], id: 'p1' },
                        { userIds: ['user-1'], id: 'p2' },
                        { userIds: ['user-1'], id: 'p3' },
                    ],
                },
            })
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

const mountWatchers = state => {
    const store = createStore(reducer, state, reduxBatch)
    let tree
    act(() => {
        tree = create(
            <Provider store={store}>
                <InitLoadView />
            </Provider>
        )
    })
    return { store, tree }
}
const feed = (id, isPrivate) => ({ tasks: { [id]: { isPrivate, update: { feed: { lastChangeDate: 1 } } } } })
const emit = (projectId, data, followed = true, callIndex = 0, userId = 'user-1') => {
    const callback = Backend.watchAllNewFeedsAllTabs.mock.calls[callIndex][followed ? 2 : 3]
    act(() => callback(projectId, selectNewFeeds(data, 99, userId)))
}

describe('global update aggregation', () => {
    beforeEach(() => jest.clearAllMocks())

    it('keeps both projects and counts across switches, including private-feed filtering', () => {
        const { store, tree } = mountWatchers({ ...initialState, selectedProjectIndex: 0 })
        emit('p1', feed('visible-1'))
        emit('p2', { tasks: { ...feed('visible-2').tasks, ...feed('hidden', 'other-user').tasks } })
        emit('p1', feed('visible-1'), false)
        emit('p2', feed('visible-2'), false)
        expect(store.getState().followedFeedsAmount).toBe(2)
        expect(store.getState().allFeedsAmount).toBe(2)
        expect(store.getState().followedFeedsData.p2.map(item => item.objectId)).toEqual(['visible-2'])
        for (const selectedProjectIndex of [1, -1, 0]) {
            act(() => store.dispatch({ type: 'patch', patch: { selectedProjectIndex } }))
            expect(store.getState().followedFeedsAmount).toBe(2)
            expect(Object.keys(store.getState().followedFeedsData)).toEqual(['p1', 'p2'])
        }
        expect(openProjectIds()).toEqual([['p1', 'p2']])
        expect(Backend.watchNewFeedsAllTabs).not.toHaveBeenCalled()
        expect(Backend.unsubNewFeedsTab).not.toHaveBeenCalled()
        // Snapshots continue to aggregate after navigation, rather than using a stale project closure.
        emit('p1', { tasks: { ...feed('visible-1').tasks, ...feed('visible-3').tasks } })
        expect(store.getState().followedFeedsAmount).toBe(3)
        act(() => tree.unmount())
    })

    it('drops revoked membership data immediately and ignores retired/unauthorized deliveries', () => {
        const { store, tree } = mountWatchers(initialState)
        emit('p1', feed('a'))
        emit('p2', feed('b'))
        emit('p1', feed('a'), false)
        emit('p2', feed('b'), false)
        act(() =>
            store.dispatch({
                type: 'patch',
                patch: {
                    loggedUserProjects: [
                        { id: 'p1', userIds: ['user-1'] },
                        { id: 'p2', userIds: ['other-user'] },
                    ],
                },
            })
        )
        expect(openProjectIds()).toEqual([['p1', 'p2'], ['p1']])
        expect(store.getState().followedFeedsAmount).toBe(0)
        expect(store.getState().followedFeedsData).toEqual({})
        expect(store.getState().allFeedsAmount).toBe(0)
        expect(store.getState().allFeedsData).toEqual({})
        emit('p2', feed('late'))
        emit('p2', feed('late'), false)
        emit('p2', feed('unauthorized'), true, 1)
        expect(store.getState().followedFeedsData).toEqual({})
        emit('p1', feed('current'), true, 1)
        expect(store.getState().followedFeedsAmount).toBe(1)
        expect(Object.keys(store.getState().followedFeedsData)).toEqual(['p1'])
        // Last project removed: no stale badge/data remain even when no snapshot can arrive.
        act(() => store.dispatch({ type: 'patch', patch: { loggedUserProjects: [] } }))
        expect(store.getState().followedFeedsAmount).toBe(0)
        expect(store.getState().allFeedsAmount).toBe(0)
        expect(store.getState().followedFeedsData).toEqual({})
        expect(store.getState().allFeedsData).toEqual({})
        act(() => tree.unmount())
    })

    it('resets counts when the signed-in user changes and rejects old callbacks', () => {
        const { store, tree } = mountWatchers(initialState)
        emit('p1', feed('previous-user'))
        emit('p1', feed('previous-user'), false)
        act(() =>
            store.dispatch({
                type: 'patch',
                patch: {
                    loggedUser: { ...initialState.loggedUser, uid: 'user-2' },
                    loggedUserProjects: [{ id: 'p1', userIds: ['user-2'] }],
                },
            })
        )
        expect(store.getState().followedFeedsAmount).toBe(0)
        emit('p1', feed('late-previous-user'))
        expect(store.getState().followedFeedsData).toEqual({})
        emit('p1', feed('new-user'), true, 1, 'user-2')
        expect(store.getState().followedFeedsData.p1[0].objectId).toBe('new-user')
        act(() => tree.unmount())
    })
})
