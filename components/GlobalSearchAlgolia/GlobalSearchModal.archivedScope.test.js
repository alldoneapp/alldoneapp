/**
 * @jest-environment jsdom
 *
 * AT-2390 — the search popup's project scope.
 *
 * Three things are pinned here, and the first is the reported bug:
 *
 * 1. The Archived tab was ALWAYS EMPTY. `updateInactiveProjectsData`
 *    (redux/store.js) masks `loggedUser.archivedProjectIds` to `[]` whenever
 *    `areArchivedActive` is false — the default — and the popup bucketed its
 *    project list with `getArchivedProjects2`, which reads that masked set. So
 *    archived projects never entered the popup's `projects` list at all, and the
 *    picker's Archived tab (which filters that same list by the UNMASKED
 *    `realArchivedProjectIds`) had nothing to show. The store here is set up
 *    exactly like a real default account: real archived ids present, masked ones
 *    empty, archived mode off.
 *
 * 2. The scope offers exactly two groups, Active and Archived.
 *
 * 3. "All archived" is offered alongside the individual archived projects, and
 *    picking it searches every archived project — while the default all-active
 *    scope keeps searching only active ones.
 */
import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Provider } from 'react-redux'

import store from '../../redux/store'
import { overrideStore, showGlobalSearchPopup } from '../../redux/actions'
import GlobalSearchModal from './GlobalSearchModal'
import SearchForm from './Form/SearchForm'
import { ScopeChip, ToggleChip } from './Filter/SearchFilterChips'
import SelectProjectModalInSearch from '../UIComponents/FloatModals/SelectProjectModal/SelectProjectModalInSearch'
import ProjectListModal from '../UIComponents/FloatModals/ProjectListModal/ProjectListModal'
import {
    ALL_ARCHIVED_PROJECTS_OPTION,
    ALL_PROJECTS_OPTION,
} from '../UIComponents/FloatModals/SelectProjectModal/projectPickerConstants'
import { translate } from '../../i18n/TranslationService'

const searchCalls = []

jest.mock('../../utils/typesenseSearch', () => ({
    multiSearchTypesense: async searches => {
        searches.forEach(({ collection, query, filterBy }) => {
            searchCalls.push({ indexName: collection, text: query, filters: filterBy })
        })
        return searches.map(() => ({ hits: [] }))
    },
}))

const ACTIVE_PROJECT = { id: 'project-active', name: 'Alldone Product', color: 'sky', sortIndexByUser: {} }
const OTHER_ACTIVE_PROJECT = { id: 'project-active-2', name: 'Juno', color: 'pink', sortIndexByUser: {} }
const ARCHIVED_PROJECT = { id: 'project-archived', name: 'Old Venture', color: 'grey', sortIndexByUser: {} }
const OTHER_ARCHIVED_PROJECT = { id: 'project-archived-2', name: 'Older Venture', color: 'grey', sortIndexByUser: {} }
const GUIDE_PROJECT = { id: 'project-guide', name: 'Getting started', color: 'sky', sortIndexByUser: {} }

const ALL_PROJECTS = [ACTIVE_PROJECT, OTHER_ACTIVE_PROJECT, ARCHIVED_PROJECT, OTHER_ARCHIVED_PROJECT, GUIDE_PROJECT]

jest.mock('../../utils/backends/firestore', () => {
    const actual = jest.requireActual('../../utils/backends/firestore')
    return {
        ...actual,
        getAllUserProjects: jest.fn(async () => [
            { id: 'project-active', name: 'Alldone Product', color: 'sky', sortIndexByUser: {} },
            { id: 'project-active-2', name: 'Juno', color: 'pink', sortIndexByUser: {} },
            { id: 'project-archived', name: 'Old Venture', color: 'grey', sortIndexByUser: {} },
            { id: 'project-archived-2', name: 'Older Venture', color: 'grey', sortIndexByUser: {} },
            { id: 'project-guide', name: 'Getting started', color: 'sky', sortIndexByUser: {} },
        ]),
        watchUserProjects: jest.fn(),
        unwatch: jest.fn(),
        runHttpsCallableFunction: jest.fn(async () => ({})),
        spentGold: jest.fn(async () => ({ success: false })),
    }
})

// A real default account: `areArchivedActive` is false, so the store has already
// emptied the masked `archivedProjectIds` and removed those ids from
// `projectIds`. Only the `real*` sets still know the truth. This IS the bug's
// precondition — with archived mode ON the tab happened to work.
const loggedUser = {
    uid: 'user-1',
    displayName: 'Karsten',
    photoURL: '',
    premium: { status: 'free' },
    realProjectIds: ['project-active', 'project-active-2', 'project-archived', 'project-archived-2', 'project-guide'],
    realArchivedProjectIds: ['project-archived', 'project-archived-2'],
    realGuideProjectIds: ['project-guide'],
    realTemplateProjectIds: [],
    projectIds: ['project-active', 'project-active-2', 'project-guide'],
    archivedProjectIds: [],
    guideProjectIds: ['project-guide'],
    templateProjectIds: [],
    quotaWarnings: {},
    workstreams: {},
    gold: 0,
    themeName: 'default',
    isAnonymous: false,
    sidebarExpanded: true,
}

describe('GlobalSearchModal — project scope groups (AT-2390)', () => {
    let component

    const mount = async (storeOverrides = {}) => {
        store.dispatch(
            overrideStore({
                ...store.getState(),
                loggedUser,
                loggedUserProjects: ALL_PROJECTS,
                areArchivedActive: false,
                ...storeOverrides,
            })
        )
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
        await act(async () => {})
    }

    const openScopePicker = async () => {
        await act(async () => component.root.findByType(ScopeChip).props.onPress())
        return component.root.findByType(ProjectListModal)
    }

    const search = async term => {
        await act(async () => component.root.findByType(SearchForm).props.setLocalText(term))
        await act(async () => component.root.findByType(SearchForm).props.onPressButton())
    }

    // Mirrors ProjectListModal's own `commit()`: hand the chosen option up, then
    // close. Going through the picker's props rather than a state setter is what
    // makes this cover the sentinel wiring; the row-press path that produces the
    // sentinel is pinned separately in ProjectListModalLeadingOption.test.js.
    const chooseScope = async optionId => {
        const picker = await openScopePicker()
        await act(async () => {
            await picker.props.onSelectProject({ id: optionId })
            picker.props.closeModal()
        })
    }

    const searchedProjectIds = () => {
        const filters = searchCalls[0]?.filters || ''
        const match = filters.match(/projectId:=\[(.*?)\]/)
        return match
            ? match[1]
                  .split(',')
                  .map(value => value.replace(/`/g, ''))
                  .sort()
            : []
    }

    beforeEach(() => {
        searchCalls.length = 0
    })

    afterEach(() => {
        act(() => component.unmount())
    })

    it('shows only the Active and Archived groups', async () => {
        await mount()
        const picker = await openScopePicker()

        expect(picker.props.tabs.map(tab => tab.name)).toEqual(['Active', 'Archived'])
    })

    it('lists the archived projects in the Archived group, with archived mode OFF', async () => {
        // The reported bug, end to end through the real picker.
        await mount()
        const picker = await openScopePicker()

        const archivedTab = picker.props.tabs.find(tab => tab.name === 'Archived')
        expect(archivedTab.projects.map(project => project.id).sort()).toEqual([
            'project-archived',
            'project-archived-2',
        ])
    })

    it('keeps archived projects out of the Active group', async () => {
        await mount()
        const picker = await openScopePicker()

        const activeTab = picker.props.tabs.find(tab => tab.name === 'Active')
        expect(activeTab.projects.map(project => project.id).sort()).toEqual(['project-active', 'project-active-2'])
    })

    it('offers "All archived" alongside the individual archived projects', async () => {
        await mount()
        const picker = await openScopePicker()

        const archivedTab = picker.props.tabs.find(tab => tab.name === 'Archived')
        expect(archivedTab.leadingOptionId).toBe(ALL_ARCHIVED_PROJECTS_OPTION)
        // Alongside, not instead of.
        expect(archivedTab.projects).toHaveLength(2)
    })

    it('hides the Archived group entirely for a user with no archived projects', async () => {
        await mount({
            loggedUser: { ...loggedUser, realArchivedProjectIds: [] },
        })
        const picker = await openScopePicker()

        expect(picker.props.tabs.map(tab => tab.name)).toEqual(['Active'])
    })

    it('searches every archived project when "All archived" is picked', async () => {
        await mount()
        await chooseScope(ALL_ARCHIVED_PROJECTS_OPTION)
        await search('venture')

        expect(searchCalls).toHaveLength(5)
        expect(searchedProjectIds()).toEqual(['project-archived', 'project-archived-2'])
    })

    it('still searches only the active projects by default', async () => {
        // The existing Active behaviour is deliberately unchanged: an all-active
        // search never covered archived or guide projects, and still does not.
        await mount()
        await search('venture')

        expect(searchedProjectIds()).toEqual(['project-active', 'project-active-2'])
    })

    it('searches one project when a specific one is picked', async () => {
        await mount()
        await chooseScope(ARCHIVED_PROJECT.id)
        await search('venture')

        expect(searchedProjectIds()).toEqual(['project-archived'])
    })

    it('labels the scope chip for each group scope', async () => {
        await mount()
        expect(component.root.findByType(ScopeChip).props.selectedProject.id).toBe(ALL_PROJECTS_OPTION)

        await chooseScope(ALL_ARCHIVED_PROJECTS_OPTION)

        expect(component.root.findByType(ScopeChip).props.selectedProject.id).toBe(ALL_ARCHIVED_PROJECTS_OPTION)
        // The label has to reach rendered output — the chip is the only place the
        // chosen scope is visible once the picker closes.
        expect(JSON.stringify(component.toJSON())).toContain(translate('All archived'))
    })

    it('opens the picker on the Archived tab when an archived scope is active', async () => {
        await mount()
        await chooseScope(ALL_ARCHIVED_PROJECTS_OPTION)

        const picker = await openScopePicker()
        expect(picker.props.tabs[picker.props.initialTabIndex].name).toBe('Archived')
    })

    it('never offers guide or template projects as a scope', async () => {
        await mount()
        const picker = await openScopePicker()

        const offeredIds = picker.props.tabs.flatMap(tab => tab.projects.map(project => project.id))
        expect(offeredIds).not.toContain(GUIDE_PROJECT.id)
        expect(component.root.findByType(SelectProjectModalInSearch).props.showGuideTab).toBe(false)
        expect(component.root.findByType(SelectProjectModalInSearch).props.showTemplateTab).toBe(false)
    })

    it('leaves the created-by-me chip working', async () => {
        // Sanity check that reworking the filter row did not disturb its sibling.
        await mount()
        const chip = component.root
            .findAllByType(ToggleChip)
            .find(toggle => toggle.props.testID === 'search-filter-created-by-me')
        expect(chip.props.selected).toBe(false)
    })
})
