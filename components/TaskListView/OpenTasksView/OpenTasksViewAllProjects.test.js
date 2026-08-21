import React from 'react'
import renderer from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'

import OpenTasksViewAllProjects from './OpenTasksViewAllProjects'
import { getProjectIdsForAllProjectsTasks } from './openTasksViewProjectScope'
import useProgressiveReveal from '../../../hooks/useProgressiveReveal'

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
}))
jest.mock('./OpenTasksByProject', () => 'OpenTasksByProject')
jest.mock('./AllProjectsEmptyInbox', () => 'AllProjectsEmptyInbox')
jest.mock('./AllProjectsShowMoreButtonContainer', () => 'AllProjectsShowMoreButtonContainer')
jest.mock('../Header/AllProjectsLine/AllProjectsLine', () => 'AllProjectsLine')
jest.mock('../PriorityFilters/TaskFiltersLine', () => 'TaskFiltersLine')
jest.mock('../EmailLine/EmailLine', () => 'EmailLine')
jest.mock('../EmailLine/emailLineFeature', () => ({ EMAIL_LINE_ENABLED: true }))
jest.mock('../../MyDayView/AssistantLine/AssistantLine', () => 'AssistantLine')
jest.mock('../../../hooks/useProgressiveReveal', () => jest.fn())
jest.mock('./openTasksViewProjectScope', () => ({
    getProjectIdsForAllProjectsTasks: jest.fn(() => ['project-1', 'project-2']),
}))
jest.mock('../../../redux/actions', () => ({
    resetLoadingData: jest.fn(() => ({ type: 'Reset loading data' })),
    setLaterTasksExpandState: jest.fn(state => ({ type: 'Set later tasks expand state', state })),
}))

const buildState = ({ openTasksAmount, todayEmptyGoalsTotal }) => ({
    smallScreenNavigation: false,
    isMiddleScreen: false,
    openTasksAmount,
    todayEmptyGoalsTotalAmountInOpenTasksView: { total: todayEmptyGoalsTotal },
    loggedUserProjectsMap: {},
    loggedUser: {
        uid: 'user-1',
        projectIds: ['project-1'],
        guideProjectIds: [],
        archivedProjectIds: [],
        templateProjectIds: [],
        inFocusTaskProjectId: null,
    },
})

const renderView = state => {
    useSelector.mockImplementation(selector => selector(state))
    return renderer.create(<OpenTasksViewAllProjects />)
}

// react-native-web renders the container View as a host div, so read the
// rendered order off the AllProjectsLine's parent instead of a 'View' lookup.
const renderedChildTypes = tree => tree.root.findByType('AllProjectsLine').parent.children.map(child => child.type)

describe('OpenTasksViewAllProjects', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        useDispatch.mockReturnValue(jest.fn())
        useProgressiveReveal.mockImplementation(totalCount => ({
            visibleAmount: totalCount,
            complete: true,
        }))
    })

    it('AT-2262: puts the empty-inbox congrats right under the assistant line', () => {
        const tree = renderView(buildState({ openTasksAmount: 0, todayEmptyGoalsTotal: 0 }))
        const childTypes = renderedChildTypes(tree)

        // The assistant line (which also renders the latest comment) keeps the top of the
        // page, immediately under the All Projects line...
        expect(childTypes.indexOf('AssistantLine')).toBe(childTypes.indexOf('AllProjectsLine') + 1)
        // ...and the congrats is its immediate sibling below it — never above it.
        expect(childTypes.indexOf('AllProjectsEmptyInbox')).toBe(childTypes.indexOf('AssistantLine') + 1)
        expect(childTypes.indexOf('AllProjectsEmptyInbox')).toBeGreaterThan(childTypes.indexOf('AllProjectsLine'))
        // Still high on the page: above the email line, the filters and the task list.
        expect(childTypes.indexOf('AllProjectsEmptyInbox')).toBeLessThan(childTypes.indexOf('EmailLine'))
        expect(childTypes.indexOf('AllProjectsEmptyInbox')).toBeLessThan(childTypes.indexOf('TaskFiltersLine'))
        expect(childTypes.indexOf('AllProjectsEmptyInbox')).toBeLessThan(childTypes.indexOf('OpenTasksByProject'))
    })

    it('keeps the assistant, email and filter lines in their usual order', () => {
        const tree = renderView(buildState({ openTasksAmount: 3, todayEmptyGoalsTotal: 0 }))
        const childTypes = renderedChildTypes(tree)

        expect(childTypes).not.toContain('AllProjectsEmptyInbox')
        expect(childTypes.indexOf('AssistantLine')).toBeLessThan(childTypes.indexOf('EmailLine'))
        expect(childTypes.indexOf('EmailLine')).toBeLessThan(childTypes.indexOf('TaskFiltersLine'))
        expect(childTypes.indexOf('TaskFiltersLine')).toBeLessThan(childTypes.indexOf('OpenTasksByProject'))
    })

    it('only shows the congrats when there are neither open tasks nor empty goals today', () => {
        expect(
            renderedChildTypes(renderView(buildState({ openTasksAmount: 0, todayEmptyGoalsTotal: 2 })))
        ).not.toContain('AllProjectsEmptyInbox')
        expect(
            renderedChildTypes(renderView(buildState({ openTasksAmount: 5, todayEmptyGoalsTotal: 0 })))
        ).not.toContain('AllProjectsEmptyInbox')
    })

    // AT-2337 / AT-2335 - "All projects" means ACTIVE projects. The board no longer
    // appends guideProjectIds; it delegates the scope to the shared helper, which is
    // built on the same ProjectHelper.getActiveProjects2 the Contacts view adopted.
    it('scopes the board through the active-project helper with the slices it selects', () => {
        const state = buildState({ openTasksAmount: 1, todayEmptyGoalsTotal: 0 })
        state.loggedUser.projectIds = ['project-1', 'guide-project']
        state.loggedUser.guideProjectIds = ['guide-project']
        state.loggedUserProjectsMap = { 'project-1': { id: 'project-1' } }

        renderView(state)

        expect(getProjectIdsForAllProjectsTasks).toHaveBeenCalledWith({
            projectIds: ['project-1', 'guide-project'],
            guideProjectIds: ['guide-project'],
            archivedProjectIds: [],
            templateProjectIds: [],
            loggedUserProjectsMap: state.loggedUserProjectsMap,
            loggedUserId: 'user-1',
            inFocusTaskProjectId: null,
        })
    })

    // AT-2337 - "All projects -> Tasks" is slow.
    //
    // This board renders one OpenTasksByProject per project (78 on a heavy
    // dogfooding account) and re-renders whenever ANY of the store slices it
    // watches change - including once per project as each project's first-day
    // task count arrives. The project list must therefore be memoised: it is an
    // O(projects) sort recomputed on every render, and - more importantly - a
    // fresh array identity on every render is a changed prop for all 78
    // children, which defeats React.memo on them.
    describe('project list memoisation', () => {
        it('does not recompute the sorted project list on a re-render with unchanged inputs', () => {
            const state = buildState({ openTasksAmount: 1, todayEmptyGoalsTotal: 0 })
            useSelector.mockImplementation(selector => selector(state))
            const tree = renderer.create(<OpenTasksViewAllProjects />)

            expect(getProjectIdsForAllProjectsTasks).toHaveBeenCalledTimes(1)

            renderer.act(() => {
                tree.update(<OpenTasksViewAllProjects />)
            })

            expect(getProjectIdsForAllProjectsTasks).toHaveBeenCalledTimes(1)
        })

        it('hands every project block the SAME array instance across re-renders', () => {
            const state = buildState({ openTasksAmount: 1, todayEmptyGoalsTotal: 0 })
            useSelector.mockImplementation(selector => selector(state))
            const tree = renderer.create(<OpenTasksViewAllProjects />)

            const idsBefore = tree.root.findAllByType('OpenTasksByProject')[0].props.sortedLoggedUserProjectIds

            renderer.act(() => {
                tree.update(<OpenTasksViewAllProjects />)
            })

            const idsAfter = tree.root.findAllByType('OpenTasksByProject')[0].props.sortedLoggedUserProjectIds

            // Referential equality, not deep equality - that is what React.memo compares.
            expect(idsAfter).toBe(idsBefore)
        })

        it('recomputes when the project inputs actually change', () => {
            const state = buildState({ openTasksAmount: 1, todayEmptyGoalsTotal: 0 })
            useSelector.mockImplementation(selector => selector(state))
            const tree = renderer.create(<OpenTasksViewAllProjects />)
            expect(getProjectIdsForAllProjectsTasks).toHaveBeenCalledTimes(1)

            const nextState = buildState({ openTasksAmount: 1, todayEmptyGoalsTotal: 0 })
            nextState.loggedUser.projectIds = ['project-1', 'project-2']
            useSelector.mockImplementation(selector => selector(nextState))

            renderer.act(() => {
                tree.update(<OpenTasksViewAllProjects />)
            })

            expect(getProjectIdsForAllProjectsTasks).toHaveBeenCalledTimes(2)
        })
    })

    describe('progressive project mounting', () => {
        it('keeps the tab-switch render to the first project block', () => {
            useProgressiveReveal.mockReturnValue({ visibleAmount: 1, complete: false })

            const tree = renderView(buildState({ openTasksAmount: 2, todayEmptyGoalsTotal: 0 }))
            const projectBlocks = tree.root.findAllByType('OpenTasksByProject')

            expect(projectBlocks).toHaveLength(1)
            expect(projectBlocks[0].props.projectId).toBe('project-1')
            expect(tree.root.findAllByType('AllProjectsShowMoreButtonContainer')).toHaveLength(0)
        })

        it('mounts the global show-more controls only after every project block is present', () => {
            useProgressiveReveal.mockReturnValue({ visibleAmount: 2, complete: true })

            const tree = renderView(buildState({ openTasksAmount: 2, todayEmptyGoalsTotal: 0 }))

            expect(tree.root.findAllByType('OpenTasksByProject')).toHaveLength(2)
            expect(tree.root.findAllByType('AllProjectsShowMoreButtonContainer')).toHaveLength(1)
        })
    })
})
