/**
 * @jest-environment jsdom
 *
 * AT-2258 — "I should be able to filter search results to only objects which I
 * have created."
 *
 * `searchFilters.test.js` pins the filter STRINGS. This suite pins the WIRING
 * that produces them: that the option reaches `algoliaIndex.search` for every
 * index, that toggling it re-runs the query, and — most importantly — that it
 * stays off until the user asks for it, so ordinary searching is untouched.
 *
 * It also pins WHERE the option lives. It first shipped inside the "Select
 * search scope" modal and was immediately reported as missing ("I don't see any
 * new filters in the search popup"), so `renders the option in the popup itself`
 * below is a regression test for discoverability, not a rendering detail: the
 * toggle must be reachable without opening any other modal.
 */
import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Provider } from 'react-redux'

import store from '../../redux/store'
import { overrideStore, showGlobalSearchPopup } from '../../redux/actions'
import GlobalSearchModal from './GlobalSearchModal'
import SearchForm from './Form/SearchForm'
import ProjectFilter from './Filter/ProjectFilter'
import CreatedByMeOption from './Filter/CreatedByMeOption'
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
    dev_goals: 'creatorId',
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

    const createdByMeOption = () => component.root.findByType(CreatedByMeOption)

    // Presses the row the way the user does, rather than calling a state setter,
    // so the assertion covers the wiring and not just the reducer.
    const setCreatedByMe = async value => {
        if (createdByMeOption().props.enabled === value) return
        await act(async () => createdByMeOption().props.onToggle())
    }

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

    it('renders the option in the popup itself, off by default', async () => {
        await mount()

        // No scope modal opened first: this is the whole point of the follow-up.
        expect(component.root.findAllByType(SelectProjectModalInSearch)).toHaveLength(0)
        expect(createdByMeOption().props.enabled).toBe(false)
        expect(typeof createdByMeOption().props.onToggle).toBe('function')
    })

    it('keeps the scope modal free of the creator filter', async () => {
        // The scope modal REPLACES the popup body while open. Leaving a second
        // copy of the toggle in there would mean two controls for one piece of
        // state, only one of which is ever visible.
        await mount()
        await openScopeModal()

        const modal = component.root.findByType(SelectProjectModalInSearch)
        expect(modal.props.createdByMeOnly).toBeUndefined()
        expect(modal.props.setCreatedByMeOnly).toBeUndefined()
        expect(component.root.findAllByType(CreatedByMeOption)).toHaveLength(0)
    })

    it('re-runs the search filtered to the logged user, on every index', async () => {
        await mount()
        await search('invoice')
        searchCalls.length = 0

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

        await setCreatedByMe(true)

        const contacts = searchCalls.find(call => call.indexName === 'dev_contacts')
        expect(contacts.filters).toContain('isAssistant:false')
    })

    it('does not fire a search when toggled with an empty search box', async () => {
        await mount()
        await setCreatedByMe(true)

        expect(searchCalls).toHaveLength(0)
    })

    it('shows the active state on the row, and clears it when turned back off', async () => {
        await mount()
        expect(createdByMeOption().props.enabled).toBe(false)

        await setCreatedByMe(true)
        expect(createdByMeOption().props.enabled).toBe(true)

        await setCreatedByMe(false)
        expect(createdByMeOption().props.enabled).toBe(false)
    })

    it('reverts to unfiltered results when the option is turned back off', async () => {
        await mount()
        await search('invoice')
        await setCreatedByMe(true)
        searchCalls.length = 0

        await setCreatedByMe(false)

        expect(searchCalls).toHaveLength(5)
        searchCalls.forEach(call => {
            expect(call.filters).not.toContain(`${CREATOR_ATTRIBUTE_BY_INDEX[call.indexName]}:"user-1"`)
        })
    })
})
