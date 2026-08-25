/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'

import ContactsView from './ContactsView'
import useRateLimitedProjectReveal from '../../hooks/useRateLimitedProjectReveal'
import { ensureProjectDataLoaded } from '../../utils/InitialLoad/projectDataLoader'

const mockDispatch = jest.fn()
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch, useSelector: jest.fn() }))
jest.mock('../../hooks/useRateLimitedProjectReveal', () => jest.fn())
jest.mock('../../utils/InitialLoad/projectDataLoader', () => ({
    PROJECT_DATA_CONTACTS: 'contacts',
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
        useSelector.mockImplementation(selector => selector(STATE))
        useRateLimitedProjectReveal.mockReturnValue({
            revealedProjectIds: ['project-1', 'project-2'],
            primaryProjectId: 'project-1',
            complete: false,
        })
    })

    it('loads only admitted projects and tracks only the primary one', () => {
        let tree
        act(() => {
            tree = renderer.create(<ContactsView />)
        })

        expect(tree.root.findAllByType('ContactListByProject').map(node => node.props.projectIndex)).toEqual([0, 1])
        expect(ensureProjectDataLoaded).toHaveBeenNthCalledWith(1, 'project-1', 'contacts', {
            trackConnectionHealth: true,
        })
        expect(ensureProjectDataLoaded).toHaveBeenNthCalledWith(2, 'project-2', 'contacts', {
            trackConnectionHealth: false,
        })
        expect(tree.root.findAllByType('ContactListByProject').every(node => !node.props.requestProjectData)).toBe(true)
    })
})
