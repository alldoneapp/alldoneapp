/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'

import ContactsView, { getContactsViewCacheKey } from './ContactsView'
import useRateLimitedProjectReveal from '../../hooks/useRateLimitedProjectReveal'
import { ensureProjectDataLoaded } from '../../utils/InitialLoad/projectDataLoader'
import {
    resetSecondaryViewCacheForTests,
    SECONDARY_VIEW_CONTACTS,
    setSecondaryViewCacheEntry,
} from '../../utils/InitialLoad/secondaryViewCache'

const mockDispatch = jest.fn()
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch, useSelector: jest.fn() }))
jest.mock('../../hooks/useRateLimitedProjectReveal', () => jest.fn())
jest.mock('../../utils/InitialLoad/projectDataLoader', () => ({
    PROJECT_DATA_CONTACTS: 'contacts',
    PROJECT_DATA_USERS: 'users',
    ensureProjectDataLoaded: jest.fn(() => new Promise(() => {})),
}))
jest.mock('./ContactListByProject', () => 'ContactListByProject')
jest.mock('./ContactsHeader', () => 'ContactsHeader')
jest.mock('../HashtagFilters/HashtagFiltersView', () => 'HashtagFiltersView')
jest.mock('../ContactStatusFilters/ContactStatusFiltersView', () => 'ContactStatusFiltersView')
jest.mock('../TaskListView/Header/AllProjectsLine/AllProjectsLine', () => 'AllProjectsLine')
jest.mock('../UIComponents/NothingToShow', () => 'NothingToShow')
jest.mock('./contactsViewProjectScope', () => ({ getProjectsForContactsView: (all, projects) => projects }))
jest.mock('./contactsViewData', () => ({
    buildContactsViewData: ({ loggedUserProjects }) => ({
        filteredProjectsUsers: Object.fromEntries(loggedUserProjects.map(project => [project.id, []])),
        filteredProjectsContacts: Object.fromEntries(loggedUserProjects.map(project => [project.id, []])),
        amounts: { users: 0, contacts: 0, followedUsers: 0, followedContacts: 0 },
    }),
}))
jest.mock('./followedPeopleBatcher', () => ({
    createFollowedPeopleBatcher: () => ({ add: jest.fn(), cancel: jest.fn() }),
}))
jest.mock('../../utils/backends/Contacts/followedPeopleFirestore', () => ({ watchFollowedPeople: jest.fn() }))
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    ALL_PROJECTS_INDEX: { id: 'all' },
    checkIfSelectedAllProjects: () => true,
}))
jest.mock('../../redux/actions', () => ({
    setNavigationRoute: () => ({ type: 'navigation' }),
    startLoadingData: () => ({ type: 'start' }),
    stopLoadingData: () => ({ type: 'stop' }),
}))
jest.mock('../../URLSystem/People/URLsPeople', () => ({
    __esModule: true,
    default: { push: jest.fn() },
    URL_ALL_PROJECTS_PEOPLE_ALL: 'all',
    URL_ALL_PROJECTS_PEOPLE_FOLLOWED: 'followed',
    URL_PROJECT_PEOPLE_ALL: 'project-all',
    URL_PROJECT_PEOPLE_FOLLOWED: 'project-followed',
}))

const PROJECTS = [
    { id: 'project-1', index: 0, name: 'Alpha' },
    { id: 'project-2', index: 1, name: 'Beta' },
]
const STATE = {
    loggedUser: { uid: 'user-1' },
    contactsActiveTab: 1,
    selectedTypeOfProject: null,
    smallScreenNavigation: false,
    isMiddleScreen: false,
    selectedProjectIndex: -1,
    loggedUserProjects: PROJECTS,
    projectUsers: { 'project-1': [], 'project-2': [] },
    projectContacts: { 'project-1': [], 'project-2': [] },
}

describe('ContactsView project admission', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        resetSecondaryViewCacheForTests()
        ensureProjectDataLoaded.mockImplementation(() => new Promise(() => {}))
        useSelector.mockImplementation(selector => selector(STATE))
        useRateLimitedProjectReveal.mockReturnValue({
            revealedProjectIds: ['project-1', 'project-2'],
            primaryProjectId: 'project-1',
            complete: false,
            nextProjectId: null,
            loadingProjectId: null,
            markProjectNearViewport: jest.fn(),
        })
    })

    afterEach(() => resetSecondaryViewCacheForTests())

    it('loads only admitted projects and tracks only the primary one', () => {
        let tree
        act(() => {
            tree = renderer.create(<ContactsView />)
        })

        expect(tree.root.findAllByType('ContactListByProject').map(node => node.props.projectIndex)).toEqual([0, 1])
        expect(ensureProjectDataLoaded).toHaveBeenNthCalledWith(1, 'project-1', ['users', 'contacts'], {
            trackConnectionHealth: true,
        })
        expect(ensureProjectDataLoaded).toHaveBeenNthCalledWith(2, 'project-2', ['users', 'contacts'], {
            trackConnectionHealth: false,
        })
        expect(tree.root.findAllByType('ContactListByProject').every(node => !node.props.requestProjectData)).toBe(true)
        expect(useRateLimitedProjectReveal).toHaveBeenCalledWith(
            expect.objectContaining({
                requireNearViewport: true,
                minIntervalMs: 200,
            })
        )
    })

    it('keeps later projects behind a viewport sentinel until they are admitted', () => {
        const markProjectNearViewport = jest.fn()
        useRateLimitedProjectReveal.mockReturnValue({
            revealedProjectIds: ['project-1'],
            primaryProjectId: 'project-1',
            complete: false,
            nextProjectId: 'project-2',
            loadingProjectId: null,
            markProjectNearViewport,
        })

        let tree
        act(() => {
            tree = renderer.create(<ContactsView />)
        })

        expect(tree.root.findAllByType('ContactListByProject').map(node => node.props.projectIndex)).toEqual([0])
        expect(ensureProjectDataLoaded).toHaveBeenCalledTimes(1)
        expect(tree.root.findAllByProps({ testID: 'contacts-list-loading-skeleton' })).toHaveLength(1)
    })

    it('renders cached visible rows while the project listeners refresh in the background', async () => {
        const cacheKey = getContactsViewCacheKey({
            activeTab: 1,
            inAllProjects: true,
            selectedProjectId: null,
            projectIds: PROJECTS.map(project => project.id),
        })
        setSecondaryViewCacheEntry(
            'user-1',
            SECONDARY_VIEW_CONTACTS,
            cacheKey,
            {
                cacheKey,
                projects: {
                    'project-1': {
                        members: [{ uid: 'cached-user', displayName: 'Cached User' }],
                        contacts: [],
                    },
                    'project-2': { members: [], contacts: [] },
                },
                amounts: { users: 1, contacts: 0, followedUsers: 0, followedContacts: 0 },
            },
            { persist: false }
        )

        ensureProjectDataLoaded.mockResolvedValue(false)
        let tree
        await act(async () => {
            tree = renderer.create(<ContactsView />)
            await Promise.resolve()
        })

        expect(tree.root.findAllByType('ContactListByProject')[0].props.members).toEqual([
            { uid: 'cached-user', displayName: 'Cached User' },
        ])
        expect(ensureProjectDataLoaded.mock.calls[0][2]).toEqual({ trackConnectionHealth: false })
    })
})
