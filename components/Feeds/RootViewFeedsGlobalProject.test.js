/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'

import RootViewFeedsGlobalProject from './RootViewFeedsGlobalProject'
import useRateLimitedProjectReveal from '../../hooks/useRateLimitedProjectReveal'

const mockDispatch = jest.fn()
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch, useSelector: jest.fn() }))
jest.mock('../../hooks/useRateLimitedProjectReveal', () => jest.fn())
jest.mock('./GlobalProject', () => 'GlobalProject')
jest.mock('./HeaderGlobalProject', () => 'HeaderGlobalProject')
jest.mock('../HashtagFilters/HashtagFiltersView', () => 'HashtagFiltersView')
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {
        getGlobalFeedProjects: (projects, user) => projects.filter(project => project.userIds?.includes(user.uid)),
    },
    ALL_PROJECTS_INDEX: { id: 'all' },
    checkIfSelectedProject: () => false,
}))
jest.mock('../SettingsView/ProjectsSettings/ProjectsSettings', () => ({
    PROJECT_TYPE_ACTIVE: 'active',
    PROJECT_TYPE_GUIDE: 'guide',
}))
jest.mock('../../URLSystem/URLSystem', () => ({ push: jest.fn() }))
jest.mock('./Utils/HelperFunctions', () => ({ getURLConstantByFollowedState: () => 'updates' }))
jest.mock('../../redux/actions', () => ({
    setReloadGlobalFeeds: value => ({ type: 'reload', value }),
    updateFeedActiveTab: value => ({ type: 'tab', value }),
}))
jest.mock('./Utils/FeedsHelper', () => ({
    HISTORICAL_MODE: 'historical',
    LOADING_MODE: 'loading',
    NEW_FEEDS_MODE: 'new',
}))
jest.mock('./Utils/FeedsConstants', () => ({ FOLLOWED_TAB: 0, ALL_TAB: 1 }))

const PROJECTS = [
    { userIds: ['user-1'], id: 'project-1', index: 0, name: 'Alpha', lastActionDate: 2 },
    { userIds: ['user-1'], id: 'project-2', index: 1, name: 'Beta', lastActionDate: 1 },
]
const STATE = {
    followedFeedsAmount: 0,
    allFeedsAmount: 0,
    feedActiveTab: 0,
    isMiddleScreen: false,
    smallScreenNavigation: false,
    loggedUserProjects: PROJECTS,
    selectedProjectIndex: -1,
    loggedUser: { uid: 'user-1', guideProjectIds: [] },
    processedInitialURL: true,
    needReloadGlobalFeeds: false,
    loadedNewFeeds: true,
}

describe('RootViewFeedsGlobalProject project admission', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        useSelector.mockImplementation(selector => selector(STATE))
        useRateLimitedProjectReveal.mockImplementation(({ projectIds }) => ({
            revealedProjectIds: projectIds,
            primaryProjectId: projectIds[0] || null,
        }))
    })

    it('tracks only the primary Updates project during initial admission', () => {
        let tree
        act(() => {
            tree = renderer.create(<RootViewFeedsGlobalProject />)
        })

        const projects = tree.root.findAllByType('GlobalProject')
        expect(projects.map(node => node.props.projectId)).toEqual(['project-1', 'project-2'])
        expect(projects.map(node => node.props.trackInitialLoad)).toEqual([true, false])
        expect(projects.every(node => typeof node.props.onInitialSnapshot === 'function')).toBe(true)
        act(() => tree.unmount())
    })
})

it('excludes projects without membership from the global feed and removes a revoked project', () => {
    let state = {
        ...STATE,
        loggedUserProjects: [...PROJECTS, { id: 'forbidden', userIds: ['someone-else'], lastActionDate: 10 }],
    }
    useSelector.mockImplementation(selector => selector(state))
    useRateLimitedProjectReveal.mockImplementation(({ projectIds }) => ({
        revealedProjectIds: projectIds,
        primaryProjectId: projectIds[0] || null,
    }))
    let tree
    act(() => {
        tree = renderer.create(<RootViewFeedsGlobalProject />)
    })
    expect(tree.root.findAllByType('GlobalProject').map(node => node.props.projectId)).toEqual([
        'project-1',
        'project-2',
    ])
    state = { ...state, loggedUserProjects: [PROJECTS[0], { ...PROJECTS[1], userIds: ['someone-else'] }] }
    act(() => tree.update(<RootViewFeedsGlobalProject />))
    expect(tree.root.findAllByType('GlobalProject').map(node => node.props.projectId)).toEqual(['project-1'])
    act(() => tree.unmount())
})
