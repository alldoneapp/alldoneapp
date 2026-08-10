/**
 * @jest-environment jsdom
 */

/**
 * AT-2160 — the user-visible half of the optimistic goal postpone.
 *
 * Both goal variants named in the bug report are covered here: a goal WITH tasks
 * (ParentGoalSection, which owns the goal row *and* the tasks under it) and a goal WITHOUT tasks
 * (EmptyGoal). While a postpone is in flight neither may render anything; when nothing is in
 * flight both must render exactly as before.
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'

const mockWatchGoal = jest.fn()
const GOAL = { id: 'goal-1', ownerId: 'user-1', lockKey: '', assigneesReminderDate: { 'user-1': 1 } }

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: jest.fn(),
    shallowEqual: jest.fn(),
}))

jest.mock('../../components/GoalsView/GoalItem', () => 'GoalItem')
jest.mock('../../components/TaskListView/OpenTasksView/NewTaskSection', () => 'NewTaskSection')
jest.mock('../../components/TaskListView/OpenTasksView/TasksList', () => 'TasksList')
jest.mock('../../components/GoalsView/SortModeActiveInfo', () => 'SortModeActiveInfo')
jest.mock('../../components/TaskListView/GoalIndicator', () => 'GoalIndicator')
jest.mock('../../components/UIComponents/FloatModals/LockedGoalModal/LockedGoalModal', () => 'LockedGoalModal')
jest.mock('../../components/Guides/guidesHelper', () => ({ objectIsLockedForUser: () => false }))
jest.mock('../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { checkIfLoggedUserIsNormalUserInGuide: () => false },
}))
jest.mock('../../utils/SharedHelper', () => ({
    __esModule: true,
    default: { checkIfUserHasAccessToProject: () => true },
}))
jest.mock('../../redux/store', () => ({
    __esModule: true,
    default: { getState: () => ({ activeEditMode: false }) },
}))
jest.mock('../../utils/BackendBridge', () => ({
    __esModule: true,
    default: {
        watchGoal: (...args) => mockWatchGoal(...args),
        unwatch: jest.fn(),
    },
}))

const ParentGoalSection = require('../../components/TaskListView/OpenTasksView/ParentGoalSection').default
const EmptyGoal = require('../../components/TaskListView/OpenTasksView/EmptyGoal').default

const STATE_BASE = {
    smallScreenNavigation: false,
    isMiddleScreen: false,
    loggedUser: { uid: 'user-1', isAnonymous: false, unlockedKeysByGuides: [], projectIds: ['project-1'] },
    currentUser: { uid: 'user-1' },
    subtaskByTaskStore: {},
    activeEditMode: false,
}

const mockState = optimisticGoalPostpones => {
    useSelector.mockImplementation(selector => selector({ ...STATE_BASE, optimisticGoalPostpones }))
}

const render = element => {
    let component
    act(() => {
        component = renderer.create(element)
    })
    return component
}

describe('AT-2160 optimistic goal postpone hides the goal immediately', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        // ParentGoalSection resolves its goal through a Firestore watcher.
        mockWatchGoal.mockImplementation((projectId, goalId, watcherKey, callback) => callback(GOAL))
    })

    describe('goal WITH tasks (ParentGoalSection)', () => {
        // A factory, not a shared constant: re-rendering the identical element object lets React
        // bail out, which would make the rollback assertion below pass or fail for the wrong reason.
        const element = () => (
            <ParentGoalSection projectId="project-1" goalId="goal-1" taskList={[{ id: 'task-1' }]} dateIndex={0} />
        )

        it('renders the goal and its tasks when no postpone is in flight', () => {
            mockState({})
            const tree = render(element()).toJSON()
            expect(tree).not.toBeNull()
            expect(JSON.stringify(tree)).toContain('TasksList')
        })

        it('renders nothing while the postpone is in flight — the tasks go with it', () => {
            mockState({ 'project-1_goal-1': { date: 2, startedAt: Date.now() } })
            expect(render(element()).toJSON()).toBeNull()
        })

        it('comes back once the postpone is rolled back', () => {
            mockState({ 'project-1_goal-1': { date: 2, startedAt: Date.now() } })
            const component = render(element())
            expect(component.toJSON()).toBeNull()

            mockState({})
            act(() => {
                component.update(element())
            })
            expect(component.toJSON()).not.toBeNull()
        })
    })

    describe('goal WITHOUT tasks (EmptyGoal)', () => {
        const element = () => <EmptyGoal goal={GOAL} projectId="project-1" dateIndex={0} />

        it('renders the goal when no postpone is in flight', () => {
            mockState({})
            expect(render(element()).toJSON()).not.toBeNull()
        })

        it('renders nothing while the postpone is in flight', () => {
            mockState({ 'project-1_goal-1': { date: 2, startedAt: Date.now() } })
            expect(render(element()).toJSON()).toBeNull()
        })

        it('is unaffected by a postpone belonging to a different goal', () => {
            mockState({ 'project-1_other-goal': { date: 2, startedAt: Date.now() } })
            expect(render(element()).toJSON()).not.toBeNull()
        })

        it('is unaffected by an entry that has already aged out', () => {
            mockState({ 'project-1_goal-1': { date: 2, startedAt: Date.now() - 60 * 60 * 1000 } })
            expect(render(element()).toJSON()).not.toBeNull()
        })
    })
})
