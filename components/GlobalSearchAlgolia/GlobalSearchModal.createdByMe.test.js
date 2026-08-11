/**
 * @jest-environment jsdom
 *
 * AT-2258 — "I should be able to filter search results to only objects which I
 * have created."
 *
 * `searchFilters.test.js` pins the filter STRINGS. This suite pins the WIRING
 * that produces them: that the option offered in the scope modal reaches
 * `algoliaIndex.search` for every index, that toggling it re-runs the query,
 * and — most importantly — that it stays off until the user asks for it, so
 * ordinary searching is untouched.
 */
import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Provider } from 'react-redux'

import store from '../../redux/store'
import { overrideStore, showGlobalSearchPopup } from '../../redux/actions'
import GlobalSearchModal from './GlobalSearchModal'
import SearchForm from './Form/SearchForm'
import ProjectFilter from './Filter/ProjectFilter'
import CreatedByMeTag from './Filter/CreatedByMeTag'
import SelectProjectModalInSearch from '../UIComponents/FloatModals/SelectProjectModal/SelectProjectModalInSearch'

const searchCalls = []

jest.mock('algoliasearch', () => () => ({
    initIndex: indexName => ({
        search: async (text, options) => {
            searchCalls.push({ indexName, text, filters: options?.filters })
            return { hits: [] }
        },
    }),
}))

const PROJECT = { id: 'project-1', name: 'Alldone Product', color: 'sky', sortIndexByUser: { 'user-1': 0 } }

jest.mock('../../utils/backends/firestore', () => {
    const actual = jest.requireActual('../../utils/backends/firestore')
    return {
        ...actual,
        getAllUserProjects: jest.fn(async () => [
            { id: 'project-1', name: 'Alldone Product', color: 'sky', sortIndexByUser: { 'user-1': 0 } },
        ]),
        watchUserProjects: jest.fn(),
        unwatch: jest.fn(),
        runHttpsCallableFunction: jest.fn(async () => ({})),
        spentGold: jest.fn(async () => ({ success: false })),
    }
})

const loggedUser = {
    uid: 'user-1',
    displayName: 'Karsten',
    photoURL: '',
    premium: { status: 'free' },
    realTemplateProjectIds: [],
    realGuideProjectIds: [],
    realArchivedProjectIds: [],
    archivedProjectIds: [],
    templateProjectIds: [],
    guideProjectIds: [],
    projectIds: ['project-1'],
    quotaWarnings: {},
    workstreams: {},
    gold: 0,
    themeName: 'default',
    isAnonymous: false,
    sidebarExpanded: true,
}

const CREATOR_ATTRIBUTE_BY_INDEX = {
    dev_tasks: 'userId',
    dev_goals: 'ownerId',
    dev_notes: 'userId',
    dev_contacts: 'recorderUserId',
    dev_updates: 'creatorId',
}

describe('GlobalSearchModal — "only objects I created" (AT-2258)', () => {
    let component

    const mount = async () => {
        store.dispatch(overrideStore({ ...store.getState(), loggedUser, loggedUserProjects: [PROJECT] }))
        store.dispatch(showGlobalSearchPopup(false))
        await act(async () => {
            component = renderer.create(
                <Provider store={store}>
                    <GlobalSearchModal />
                </Provider>,
                {
                    createNodeMock: () => ({
                        focus: jest.fn(),
                        blur: jest.fn(),
                        isFocused: () => true,
                        measure: jest.fn(),
                    }),
                }
            )
        })
        // Let the `getAllUserProjects` promise settle so `projects` is populated.
        await act(async () => {})
    }

    const search = async term => {
        await act(async () => component.root.findByType(SearchForm).props.setLocalText(term))
        await act(async () => component.root.findByType(SearchForm).props.onPressButton())
    }

    const openScopeModal = async () =>
        act(async () => component.root.findByType(ProjectFilter).props.setShowSelectProjectModal())

    const setCreatedByMe = async value =>
        act(async () => component.root.findByType(SelectProjectModalInSearch).props.setCreatedByMeOnly(value))

    // The scope modal REPLACES the search popup's body while it is open, so the
    // popup (and its tags) only exists again once it is closed.
    const closeScopeModal = async () =>
        act(async () => component.root.findByType(SelectProjectModalInSearch).props.closePopover())

    beforeEach(() => {
        searchCalls.length = 0
    })

    afterEach(() => {
        act(() => component.unmount())
    })

    it('searches every index unfiltered by creator until the user turns the option on', async () => {
        await mount()
        await search('invoice')

        expect(searchCalls).toHaveLength(5)
        searchCalls.forEach(call => {
            expect(call.filters).toContain('projectId:"project-1"')
            expect(call.filters).not.toContain(`${CREATOR_ATTRIBUTE_BY_INDEX[call.indexName]}:"user-1"`)
        })
    })

    it('offers the option in the scope modal, off by default', async () => {
        await mount()
        await openScopeModal()

        const modal = component.root.findByType(SelectProjectModalInSearch)
        expect(modal.props.createdByMeOnly).toBe(false)
        expect(typeof modal.props.setCreatedByMeOnly).toBe('function')
    })

    it('re-runs the search filtered to the logged user, on every index', async () => {
        await mount()
        await search('invoice')
        searchCalls.length = 0

        await openScopeModal()
        await setCreatedByMe(true)

        expect(searchCalls).toHaveLength(5)
        expect(Object.keys(CREATOR_ATTRIBUTE_BY_INDEX).sort()).toEqual(searchCalls.map(c => c.indexName).sort())
        searchCalls.forEach(call => {
            expect(call.text).toBe('invoice')
            expect(call.filters).toContain(`${CREATOR_ATTRIBUTE_BY_INDEX[call.indexName]}:"user-1"`)
            // The pre-existing access scoping must survive alongside it.
            expect(call.filters).toContain('projectId:"project-1"')
            expect(call.filters).toContain('isPublicFor:')
        })
    })

    it('keeps the contacts assistant exclusion when filtering by creator', async () => {
        await mount()
        await search('invoice')
        searchCalls.length = 0

        await openScopeModal()
        await setCreatedByMe(true)

        const contacts = searchCalls.find(call => call.indexName === 'dev_contacts')
        expect(contacts.filters).toContain('isAssistant:false')
    })

    it('does not fire a search when toggled with an empty search box', async () => {
        await mount()
        await openScopeModal()
        await setCreatedByMe(true)

        expect(searchCalls).toHaveLength(0)
    })

    it('surfaces the active filter as a tag, and removes it when turned back off', async () => {
        await mount()
        expect(component.root.findAllByType(CreatedByMeTag)).toHaveLength(0)

        await openScopeModal()
        await setCreatedByMe(true)
        await closeScopeModal()
        expect(component.root.findByType(ProjectFilter).props.createdByMeOnly).toBe(true)
        expect(component.root.findAllByType(CreatedByMeTag)).toHaveLength(1)

        await openScopeModal()
        await setCreatedByMe(false)
        await closeScopeModal()
        expect(component.root.findAllByType(CreatedByMeTag)).toHaveLength(0)
    })

    it('reverts to unfiltered results when the option is turned back off', async () => {
        await mount()
        await search('invoice')
        await openScopeModal()
        await setCreatedByMe(true)
        searchCalls.length = 0

        await setCreatedByMe(false)

        expect(searchCalls).toHaveLength(5)
        searchCalls.forEach(call => {
            expect(call.filters).not.toContain(`${CREATOR_ATTRIBUTE_BY_INDEX[call.indexName]}:"user-1"`)
        })
    })
})
