import React from 'react'
import renderer, { act } from 'react-test-renderer'

import GoalsView from './GoalsView'
import MilestonesListByProject from './MilestonesListByProject'

let mockState
jest.mock('react-redux', () => ({ useDispatch: () => jest.fn(), useSelector: selector => selector(mockState) }))
jest.mock('../../redux/store', () => ({ getState: () => mockState }))
jest.mock('../../redux/actions', () => new Proxy({}, { get: (_, type) => () => ({ type }) }))
jest.mock('../MyDayView/AssistantLine/AllProjectsAssistantLine', () => 'AllProjectsAssistantLine')
jest.mock('../MyDayView/AssistantLine/ProjectAssistantLine', () => 'ProjectAssistantLine')
jest.mock('../TaskListView/Header/AllProjectsLine/AllProjectsLine', () => 'AllProjectsLine')
jest.mock('../TaskListView/Header/ProjectHeader', () => 'ProjectHeader')
jest.mock('../TaskListView/ProjectSection', () => ({
    __esModule: true,
    default: 'ProjectSection',
    ProjectSectionBody: 'ProjectSectionBody',
}))
jest.mock('../HashtagFilters/HashtagFiltersView', () => 'HashtagFiltersView')
jest.mock('../ModalsManager/modalsManager', () => ({ exitsOpenModals: () => false }))
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { checkIfLoggedUserIsNormalUserInGuide: () => false },
    checkIfSelectedAllProjects: index => index === -1,
}))
jest.mock('./GoalsViewSelectedProject', () => 'GoalsViewSelectedProject')
jest.mock('./GoalsViewAllProjects', () => 'GoalsViewAllProjects')
jest.mock('./GoalsHelper', () => ({ GOALS_OPEN_TAB_INDEX: 0, filterMilestonesAndGoalsInCurrentUser: jest.fn() }))
jest.mock('./GoalsBacklog', () => 'GoalsBacklog')
jest.mock('./MilestoneItem', () => 'MilestoneItem')
jest.mock('./AddGoals', () => 'AddGoals')
jest.mock('./EmptyGoalsSelectedProject', () => 'EmptyGoalsSelectedProject')
jest.mock('./GoalsBoardMilestonesHelper', () => ({ getPreviousOpenMilestoneDate: jest.fn() }))
jest.mock('../UIControls/ShowMoreButton', () => 'ShowMoreButton')
jest.mock('../../utils/HelperFunctions', () => ({ dismissAllPopups: jest.fn() }))
jest.mock('../TaskListView/Utils/TasksHelper', () => ({ BACKLOG_DATE_NUMERIC: 0 }))

const project = { id: 'project', index: 0 }
const render = component => {
    let tree
    act(() => {
        tree = renderer.create(component)
    })
    return tree
}

beforeEach(() => {
    mockState = {
        loggedUser: { uid: 'user' },
        currentUser: { uid: 'user' },
        selectedProjectIndex: -1,
        loggedUserProjects: [project],
        loggedUserProjectsMap: { project },
        goalsActiveTab: 0,
        boardMilestonesByProject: {},
        goalsByProject: {},
        openMilestonesByProject: {},
        doneMilestonesByProject: {},
        boardNeedShowMoreByProject: {},
    }
})

it.each([0, 1])('shows one global line before goal filters on tab %s', goalsActiveTab => {
    mockState.goalsActiveTab = goalsActiveTab
    const tree = render(<GoalsView />)
    const nodes = tree.root.findAll(node => typeof node.type === 'string').map(node => node.type)
    expect(tree.root.findAllByType('AllProjectsAssistantLine')).toHaveLength(1)
    expect(nodes.indexOf('AllProjectsLine')).toBeLessThan(nodes.indexOf('AllProjectsAssistantLine'))
    expect(nodes.indexOf('AllProjectsAssistantLine')).toBeLessThan(nodes.indexOf('HashtagFiltersView'))
    act(() => tree.unmount())
})

it('does not render the global line in a selected project', () => {
    mockState.selectedProjectIndex = 0
    const tree = render(<GoalsView />)
    expect(tree.root.findAllByType('AllProjectsAssistantLine')).toHaveLength(0)
    act(() => tree.unmount())
})

it.each([0, 1])('keeps the assistant above the content of an empty selected goals tab %s', goalsActiveTab => {
    mockState.selectedProjectIndex = 0
    const tree = render(<MilestonesListByProject projectId="project" goalsActiveTab={goalsActiveTab} canShowProject />)
    const body = tree.root.findByType('ProjectSectionBody')
    expect(body.children[0].type).toBe('ProjectAssistantLine')
    expect(body.children[0].props.project).toBe(project)
    act(() => tree.unmount())
})

it('does not mount per-project assistant lines inside All Projects', () => {
    const tree = render(<MilestonesListByProject projectId="project" goalsActiveTab={0} canShowProject />)
    expect(tree.root.findAllByType('ProjectAssistantLine')).toHaveLength(0)
    act(() => tree.unmount())
})
