import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Provider } from 'react-redux'
import { createStore } from 'redux'
import useContactStatusUrlFilter from './useContactStatusUrlFilter'
import { setContactStatusFilter } from '../../redux/actions'
import { ALL_TAB, FOLLOWED_TAB } from '../Feeds/Utils/FeedsConstants'
import URLSystem from '../../URLSystem/URLSystem'

jest.mock('../../URLSystem/URLSystem', () => ({ setLastNavigationScreen: jest.fn() }))
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({ getProjectNameById: () => 'Project' }))
jest.mock('../../utils/HelperFunctions', () => ({}))

const STATUSES = { 'status-1': { name: 'Interested' }, 'status-2': { name: 'Customer' } }
const PATH = '/projects/project-1/user/user-1/contacts/all'

function Filter({ options }) {
    useContactStatusUrlFilter(options)
    return null
}

describe('Contact status links', () => {
    let store, tree, options

    const render = () =>
        act(() => {
            const element = (
                <Provider store={store}>
                    <Filter options={options} />
                </Provider>
            )
            if (tree) tree.update(element)
            else tree = renderer.create(element)
        })

    beforeEach(() => {
        jest.clearAllMocks()
        history.replaceState(null, '', PATH)
        store = createStore((state = { contactStatusFilter: null }, action) =>
            action.type === 'Set contact status filter' ? { contactStatusFilter: action.statusId } : state
        )
        options = {
            projectId: 'project-1',
            routeUserId: 'user-1',
            currentUserUid: 'user-1',
            contactsActiveTab: ALL_TAB,
            contactStatuses: STATUSES,
        }
        tree = null
    })

    afterEach(() => act(() => tree?.unmount()))

    it('restores a bookmark and updates the existing history entry when selecting or clearing a status', () => {
        history.replaceState(null, '', `${PATH}?contactStatus=status-1`)
        const historyLength = history.length
        render()
        expect(store.getState().contactStatusFilter).toBe('status-1')
        act(() => store.dispatch(setContactStatusFilter('status-2')))
        expect(window.location.search).toBe('?contactStatus=status-2')
        expect(URLSystem.setLastNavigationScreen).toHaveBeenLastCalledWith(
            `${PATH.slice(1)}?contactStatus=status-2`,
            true
        )
        expect(history.length).toBe(historyLength)
        act(() => store.dispatch(setContactStatusFilter(null)))
        expect(window.location.search).toBe('')
    })

    it('keeps the status between All and Followed and restores it after visiting contact details', () => {
        render()
        act(() => store.dispatch(setContactStatusFilter('status-1')))
        options = { ...options, contactsActiveTab: FOLLOWED_TAB }
        render()
        const savedLink = window.location.pathname + window.location.search
        expect(savedLink).toBe('/projects/project-1/user/user-1/contacts/followed?contactStatus=status-1')
        act(() => tree.unmount())
        expect(store.getState().contactStatusFilter).toBeNull()
        tree = null
        history.pushState(null, '', '/projects/project-1/contacts/contact-1/properties')
        history.replaceState(null, '', savedLink)
        render()
        expect(store.getState().contactStatusFilter).toBe('status-1')
        expect(window.location.pathname + window.location.search).toBe(savedLink)
    })

    it('clears the filter when switching projects or opening all projects', () => {
        render()
        act(() => store.dispatch(setContactStatusFilter('status-1')))
        options = { ...options, projectId: 'project-2' }
        render()
        expect(store.getState().contactStatusFilter).toBeNull()
        expect(window.location.pathname).toBe('/projects/project-2/user/user-1/contacts/all')
        act(() => store.dispatch(setContactStatusFilter('status-2')))
        options = { ...options, projectId: null }
        render()
        expect(store.getState().contactStatusFilter).toBeNull()
        expect(window.location.pathname + window.location.search).toBe('/projects/contacts/all')
    })

    it('honors a link to a different project while the contacts view stays mounted', () => {
        render()
        history.replaceState(null, '', '/projects/project-2/user/user-1/contacts/all?contactStatus=status-2')
        options = { ...options, projectId: 'project-2' }
        render()
        expect(store.getState().contactStatusFilter).toBe('status-2')
        expect(window.location.search).toBe('?contactStatus=status-2')
    })

    it('supports Unassigned and falls back to All for a deleted status', () => {
        history.replaceState(null, '', `${PATH}?contactStatus=unassigned`)
        render()
        expect(store.getState().contactStatusFilter).toBe('unassigned')
        act(() => store.dispatch(setContactStatusFilter('deleted')))
        expect(store.getState().contactStatusFilter).toBeNull()
        expect(window.location.search).toBe('')
    })

    it('preserves a bookmark until project statuses are loaded', () => {
        options = { ...options, contactStatuses: undefined }
        history.replaceState(null, '', `${PATH}?contactStatus=status-1`)
        render()
        expect(store.getState().contactStatusFilter).toBe('status-1')
        options = { ...options, contactStatuses: STATUSES }
        render()
        expect(window.location.search).toBe('?contactStatus=status-1')
    })
})
