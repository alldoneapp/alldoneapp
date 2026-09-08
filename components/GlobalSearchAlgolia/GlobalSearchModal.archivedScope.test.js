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
import { ARCHIVED_CHIP_LABEL, ScopeChip, ToggleChip } from './Filter/SearchFilterChips'
import SelectProjectModalInSearch from '../UIComponents/FloatModals/SelectProjectModal/SelectProjectModalInSearch'
import ProjectListModal from '../UIComponents/FloatModals/ProjectListModal/ProjectListModal'
import {
    ALL_ARCHIVED_PROJECTS_OPTION,
    ALL_PROJECTS_OPTION,
} from '../UIComponents/FloatModals/SelectProjectModal/projectPickerConstants'
import { translate } from '../../i18n/TranslationService'
import { getAllUserProjects } from '../../utils/backends/firestore'
import { warmTypesenseSearchCredentials } from '../../utils/typesenseSearch'

const searchCalls = []

jest.mock('../../utils/typesenseSearch', () => ({
    warmTypesenseSearchCredentials: jest.fn(async () => true),
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

    const archivedChip = () =>
        component.root.findAllByType(ToggleChip).find(chip => chip.props.testID === 'search-filter-archived')

    // Presses the chip the way the user does rather than reaching for a state
    // setter, so the assertions cover the wiring and not just the reducer.
    const setIncludeArchived = async value => {
        if (archivedChip().props.selected === value) return
        await act(async () => archivedChip().props.onPress())
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
        warmTypesenseSearchCredentials.mockClear()
        getAllUserProjects.mockResolvedValue(ALL_PROJECTS)
    })

    afterEach(() => {
        jest.restoreAllMocks()
        act(() => component.unmount())
    })

    it('shows only the Active and Archived groups', async () => {
        await mount()
        const picker = await openScopePicker()

        expect(picker.props.tabs.map(tab => tab.name)).toEqual(['Active', 'Archived'])
    })

    it('warms the scoped Typesense credential as soon as the modal opens', async () => {
        await mount()

        expect(warmTypesenseSearchCredentials).toHaveBeenCalledTimes(1)
    })

    it('falls back to loaded projects without an unhandled rejection when the scope refresh is denied', async () => {
        const permissionError = Object.assign(new Error('Missing or insufficient permissions.'), {
            code: 'permission-denied',
        })
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
        getAllUserProjects.mockRejectedValueOnce(permissionError)

        await mount({ loggedUserProjects: [ACTIVE_PROJECT, OTHER_ACTIVE_PROJECT] })
        const picker = await openScopePicker()

        expect(picker.props.tabs.map(tab => tab.name)).toEqual(['Active', 'Archived'])
        expect(picker.props.tabs[0].projects.map(project => project.id).sort()).toEqual([
            'project-active',
            'project-active-2',
        ])
        expect(picker.props.tabs[1].projects).toEqual([])
        expect(consoleError).toHaveBeenCalledWith(
            '[GlobalSearch] Could not refresh the project scope, using loaded projects',
            permissionError
        )
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

    it('searches active AND archived projects by default (AT-2524)', async () => {
        // AT-2390 pinned the opposite here ("still searches only the active
        // projects by default"). AT-2524 reversed that decision on purpose: the
        // "Include archived" chip is ON when the popup opens, so the default
        // all-projects search now spans both. Guide projects are still excluded
        // — that half of the AT-2390 rule stands.
        await mount()
        await search('venture')

        expect(searchedProjectIds()).toEqual([
            'project-active',
            'project-active-2',
            'project-archived',
            'project-archived-2',
        ])
        expect(searchedProjectIds()).not.toContain(GUIDE_PROJECT.id)
    })

    it('searches only the active projects once the archived chip is turned off', async () => {
        await mount()
        await setIncludeArchived(false)
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

    it('re-runs an existing search immediately when the scope changes', async () => {
        // The archived TOGGLE used to be the only scope control that re-ran the
        // query; changing the picked project left stale results on screen until
        // the user pressed Search again. With the toggle gone the picker is the
        // only way to reach archived results, so it has to re-run.
        await mount()
        await search('venture')
        // The default group scope is active + archived since AT-2524; picking
        // "All archived" narrows it to archived ONLY, which is the distinction
        // the chip and the scope now divide between them.
        expect(searchedProjectIds()).toEqual([
            'project-active',
            'project-active-2',
            'project-archived',
            'project-archived-2',
        ])

        searchCalls.length = 0
        await chooseScope(ALL_ARCHIVED_PROJECTS_OPTION)

        expect(searchCalls).toHaveLength(5)
        expect(searchedProjectIds()).toEqual(['project-archived', 'project-archived-2'])
    })

    it('does not fire a search when the scope changes with an empty term', async () => {
        await mount()
        await chooseScope(ALL_ARCHIVED_PROJECTS_OPTION)

        expect(searchCalls).toHaveLength(0)
    })

    it('offers the archived chip beside the scope chip, on by default (AT-2524)', async () => {
        // AT-2390 pinned this chip as absent. It is back, and the two archived
        // controls no longer overlap: the chip widens a group scope to active
        // AND archived, the picker's "All archived" searches archived only.
        await mount()

        expect(archivedChip()).toBeTruthy()
        expect(archivedChip().props.selected).toBe(true)
    })

    it('shows the archived chip in the popup itself, on desktop and on mobile', async () => {
        // "Directly" is the requirement, and it is the same discoverability
        // regression AT-2258 was reported for: the control must be readable
        // without opening the scope picker first. Finding the component by type
        // would still pass if the label were width-gated out of the tree, so
        // this asserts the translated LABEL reaches rendered output — and does
        // it in the mobile branch too, which is where the AT-2258 reports came
        // from (the popup takes a different width/sheet branch there).
        await mount()
        expect(component.root.findAllByType(SelectProjectModalInSearch)).toHaveLength(0)
        expect(JSON.stringify(component.toJSON())).toContain(translate(ARCHIVED_CHIP_LABEL))
        await act(async () => component.unmount())

        await mount({ smallScreenNavigation: true })
        expect(component.root.findAllByType(SelectProjectModalInSearch)).toHaveLength(0)
        expect(JSON.stringify(component.toJSON())).toContain(translate(ARCHIVED_CHIP_LABEL))
    })

    it('hides the archived chip while a specific project is the scope', async () => {
        // A picked project is searched whether it is archived or not, so the
        // chip could not mean anything there. Hidden, not merely inert.
        await mount()
        await chooseScope(ARCHIVED_PROJECT.id)

        expect(archivedChip()).toBeUndefined()
    })

    it('keeps the chip for the all-archived scope but lets it change nothing', async () => {
        // The scope is already entirely archived; widening it is a no-op. The
        // chip stays visible because the scope is still a GROUP scope and the
        // user is one press from going back to all-projects.
        await mount()
        await chooseScope(ALL_ARCHIVED_PROJECTS_OPTION)
        expect(archivedChip()).toBeTruthy()

        searchCalls.length = 0
        await search('venture')
        expect(searchedProjectIds()).toEqual(['project-archived', 'project-archived-2'])

        searchCalls.length = 0
        await setIncludeArchived(false)
        await search('venture')
        expect(searchedProjectIds()).toEqual(['project-archived', 'project-archived-2'])
    })

    it('hides the archived chip for a user with no archived projects', async () => {
        // Same `realArchivedProjectIds` gate the picker's Archived tab uses, so
        // the two cannot disagree about whether archived exists for this user.
        await mount({ loggedUser: { ...loggedUser, realArchivedProjectIds: [] } })

        expect(archivedChip()).toBeUndefined()
    })

    it('re-runs an existing search immediately when the archived chip is toggled', async () => {
        await mount()
        await search('venture')
        expect(searchedProjectIds()).toHaveLength(4)

        searchCalls.length = 0
        await setIncludeArchived(false)

        expect(searchCalls).toHaveLength(5)
        expect(searchedProjectIds()).toEqual(['project-active', 'project-active-2'])
    })

    it('does not fire a search when the archived chip is toggled with an empty term', async () => {
        await mount()
        await setIncludeArchived(false)

        expect(searchCalls).toHaveLength(0)
    })

    it('does not fire a search merely by opening with the chip on', async () => {
        // The chip defaults to ON, so the re-run effect must be seeded with
        // that default or every open would fire a search for an empty term.
        await mount()

        expect(searchCalls).toHaveLength(0)
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
