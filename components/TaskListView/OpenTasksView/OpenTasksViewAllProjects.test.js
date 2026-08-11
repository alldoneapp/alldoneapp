import React from 'react'
import renderer from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'

import OpenTasksViewAllProjects from './OpenTasksViewAllProjects'

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
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    getNormalAndGuideProjectsSortedBySortedAndWithProjectInFocusAtTheTop: () => ['project-1'],
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
    })

    it('AT-2262: puts the empty-inbox congrats right under the All Projects line', () => {
        const tree = renderView(buildState({ openTasksAmount: 0, todayEmptyGoalsTotal: 0 }))
        const childTypes = renderedChildTypes(tree)

        expect(childTypes.indexOf('AllProjectsEmptyInbox')).toBe(childTypes.indexOf('AllProjectsLine') + 1)
        // ...and therefore above the assistant composer, the email line and the filters.
        expect(childTypes.indexOf('AllProjectsEmptyInbox')).toBeLessThan(childTypes.indexOf('AssistantLine'))
        expect(childTypes.indexOf('AllProjectsEmptyInbox')).toBeLessThan(childTypes.indexOf('EmailLine'))
        expect(childTypes.indexOf('AllProjectsEmptyInbox')).toBeLessThan(childTypes.indexOf('TaskFiltersLine'))
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
})
