import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { AccessibilityInfo } from 'react-native'

jest.mock('../TaskHierarchy', () => ({
    TaskHierarchyGroup: ({ children }) => children,
}))

/**
 * AT-2521 — the rule for WHEN a goal leaves today's list, and the exit it plays when it does,
 * asserted on the board rather than on a hook.
 *
 * The rule, in Karsten's words: "if it has its own reminder it stays, if it's only shown because of
 * the task then it disappears". That is exactly the two sources a goal row can come from, and they
 * behave differently on purpose:
 *
 *   • ITS OWN REMINDER — the goal is in `ACTIVE_GOALS_INDEX` because its `assigneesReminderDate` is
 *     today or overdue. Completing its last task moves it to the empty-goals bucket and it STAYS,
 *     with its add-task line, ready for more work. Nothing is animated: the row is not going
 *     anywhere. It leaves later, if at all, only when the goal itself reaches 100% — and THAT
 *     departure is animated, from the empty-goal row it is sitting in.
 *   • ONLY ITS TASK — the goal is not active today at all; it is on the board purely because a task
 *     due today points at it. Completing that task removes the goal from the day in a single step,
 *     and that is the pop this animates.
 *
 * Why this suite exists at all: `useGoalSectionExit.test.js` proves the hook decides correctly and
 * `GoalSectionExitWiring.test.js` proves each row can wear the style, and AT-2507 shipped with both
 * of those green while the animation never reached a user. Everything between them lives in
 * `MainSection` — the sort that assigns each goal a position, the orphan filter that DROPS a
 * section whose goal has none, and the render budget — and a held section that is quietly discarded
 * there is indistinguishable, on screen, from never having been held.
 */

jest.mock('./ParentGoalSection', () => 'ParentGoalSection')
jest.mock('./EmptyGoal', () => 'EmptyGoal')
jest.mock('./TasksList', () => 'TasksList')
jest.mock('./NewTaskSection', () => 'NewTaskSection')
jest.mock('./GeneralTaskSectionEntry', () => 'GeneralTaskSectionEntry')
jest.mock('./GeneralTasksHeader', () => 'GeneralTasksHeader')
jest.mock('./SwipeableGeneralTasksHeader', () => 'SwipeableGeneralTasksHeader')
jest.mock('../../GoalsView/SortModeActiveInfo', () => 'SortModeActiveInfo')
jest.mock('../../UIControls/ShowMoreButton', () => 'ShowMoreButton')

jest.mock('../../../redux/actions', () => new Proxy({}, { get: () => jest.fn(() => ({ type: 'NOOP' })) }))
jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: { getState: () => ({}), dispatch: jest.fn(), subscribe: () => () => {} },
}))
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { getTypeOfProject: () => 'active', checkIfLoggedUserIsNormalUserInGuide: () => false },
    checkIfSelectedProject: () => true,
}))
jest.mock('../../../utils/HelperFunctions', () => ({ dismissAllPopups: jest.fn() }))
jest.mock('../../../utils/SharedHelper', () => ({
    __esModule: true,
    default: { checkIfUserHasAccessToProject: jest.fn(() => true) },
}))
jest.mock('../../../utils/backends/Goals/goalsFirestore', () => ({ getGoalData: jest.fn(), watchGoal: jest.fn() }))
jest.mock('../../../utils/backends/firestore', () => ({ unwatch: jest.fn() }))
jest.mock('../../../utils/BackendBridge', () => ({ __esModule: true, default: {} }))
jest.mock('../../Workstreams/WorkstreamHelper', () => ({
    DEFAULT_WORKSTREAM_ID: 'default',
    WORKSTREAM_ID_PREFIX: 'ws:',
}))
jest.mock('../../../utils/EstimationHelper', () => ({
    ESTIMATION_0_MIN: 0,
    getEstimationRealValue: () => 0,
}))
jest.mock('../Utils/TasksHelper', () => ({
    __esModule: true,
    default: {},
    // Real values: `openTasks.js` builds the synthetic backlog milestone out of them, and an
    // undefined date silently puts every goal outside every milestone window.
    BACKLOG_DATE_NUMERIC: Number.MAX_SAFE_INTEGER,
    BACKLOG_DATE_STRING: '99999999',
}))
let mockEditing = false
jest.mock('../../../utils/editingGuard', () => ({ useIsUserEditing: () => mockEditing }))

let mockStoreState = {}
jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockStoreState),
    useDispatch: () => jest.fn(),
    shallowEqual: (a, b) => a === b,
    // `@hello-pangea/dnd` reads `connect` at module scope and is reached from here through
    // `openTasks.js`. Omitting it fails the whole suite at import time, several files away from
    // anything under test.
    connect: () => Component => Component,
    Provider: ({ children }) => children,
    batch: fn => fn(),
}))

import MainSection from './MainSection'
import {
    publishGoalTaskCompletion,
    publishGoalTaskPostpone,
    resetGoalTaskCompletionListeners,
} from './goalCompletionSignal'
import { NOT_PARENT_GOAL_INDEX, TODAY_DATE } from '../../../utils/backends/openTasks'
import SharedHelper from '../../../utils/SharedHelper'

const PROJECT = 'project-1'
const USER = 'user-1'
const INSTANCE = `${PROJECT}${USER}`
const REMINDER_GOAL = 'goal-with-own-reminder'
const TASK_ONLY_GOAL = 'goal-shown-only-by-its-task'

const MILESTONE = { id: 'milestone-1', date: 1000, done: false }

const goalDoc = id => ({
    id,
    ownerId: USER,
    assigneesIds: [USER],
    assigneesReminderDate: { [USER]: 1 },
    sortIndexByMilestone: {},
    parentDoneMilestoneIds: [],
    // Inside the milestone window, so the sort gives it a position — which is what keeps a held
    // section from being treated as orphaned and dropped.
    startingMilestoneDate: 0,
    completionMilestoneDate: 2000,
    progress: 40,
    dynamicProgress: 40,
    lockKey: null,
    isPublicFor: ['all'],
})

const task = id => ({ id })

/** The day's positional array, exactly as `generateOpenTasksArray` builds it. */
const dayEntry = ({ mainTasks = [], emptyGoals = [] }) => {
    const day = [TODAY_DATE, 0, 0, mainTasks, [], [], [], [], [], [], [], emptyGoals]
    day.hasCalendarTasks = false
    day.nonCalendarTasksCount = 0
    return day
}

const setBoard = ({ mainTasks, emptyGoals, goals = [REMINDER_GOAL, TASK_ONLY_GOAL] }) => {
    const goalsById = {}
    goals.forEach(id => {
        goalsById[id] = goalDoc(id)
    })
    mockStoreState = {
        filteredOpenTasksStore: { [INSTANCE]: [dayEntry({ mainTasks, emptyGoals })] },
        thereAreHiddenNotMainTasks: {},
        smallScreenNavigation: false,
        isMiddleScreen: false,
        activeEditMode: false,
        subtaskByTaskStore: {},
        showMoreInMainSection: false,
        taskPriorityFilters: [],
        taskVmStateFilters: [],
        selectedProjectIndex: 0,
        openMilestonesByProjectInTasks: { [PROJECT]: [MILESTONE] },
        doneMilestonesByProjectInTasks: { [PROJECT]: [] },
        goalsByProjectInTasks: { [PROJECT]: goalsById },
        optimisticFocusTaskId: null,
        optimisticFocusTaskProjectId: null,
        optimisticFocusGoalId: null,
        optimisticFocusActive: false,
        optimisticGoalPostpones: {},
        currentUser: { uid: USER },
        loggedUser: {
            uid: USER,
            isAnonymous: false,
            projectIds: [PROJECT],
            numberTodayTasks: 50,
            inFocusTaskId: null,
            templateProjectIds: [],
            unlockedKeysByGuides: [],
        },
        selectedGoalDataInTasksListWhenAddTask: null,
    }
}

const element = () => (
    <MainSection
        projectId={PROJECT}
        dateIndex={0}
        isActiveOrganizeMode={false}
        projectIndex={0}
        instanceKey={INSTANCE}
        pressedShowMoreMainSection={false}
        setPressedShowMoreMainSection={() => {}}
    />
)

describe('task rows without milestone sorting data (AT-2672)', () => {
    it.each(['openMilestonesByProjectInTasks', 'doneMilestonesByProjectInTasks'])(
        'keeps the empty board composer when %s has not loaded',
        async slice => {
            setBoard({ mainTasks: [], emptyGoals: [] })
            delete mockStoreState[slice][PROJECT]
            let tree
            await act(async () => {
                tree = renderer.create(element())
            })
            expect(tree.root.findAllByType('NewTaskSection')).toHaveLength(1)
            act(() => tree.unmount())
        }
    )

    it('keeps general and goal task rows, then restores grouping when milestones arrive', async () => {
        const generalTask = task('general-task')
        const goalTask = task('goal-task')
        const mainTasks = [
            [NOT_PARENT_GOAL_INDEX, [generalTask]],
            [TASK_ONLY_GOAL, [goalTask]],
        ]
        setBoard({ mainTasks, emptyGoals: [] })
        delete mockStoreState.doneMilestonesByProjectInTasks[PROJECT]
        let tree
        await act(async () => {
            tree = renderer.create(element())
        })
        const list = tree.root.findByType('TasksList')
        expect(list.props.taskList).toEqual([generalTask, goalTask])
        expect(tree.root.findAllByType('NewTaskSection')).toHaveLength(1)
        // The fallback is presentation only; it must not reparent the stored task group.
        expect(mainTasks).toEqual([
            [NOT_PARENT_GOAL_INDEX, [generalTask]],
            [TASK_ONLY_GOAL, [goalTask]],
        ])

        await act(async () => {
            mockEditing = true
            mockStoreState.doneMilestonesByProjectInTasks[PROJECT] = []
            tree.update(element())
        })
        expect(tree.root.findByType('TasksList').props.taskList).toEqual([generalTask, goalTask])
        expect(tree.root.findAllByType('ParentGoalSection')).toHaveLength(0)
        await act(async () => {
            mockEditing = false
            tree.update(element())
        })
        expect(tree.root.findByType('TasksList').props.taskList).toEqual([generalTask])
        expect(tree.root.findByType('ParentGoalSection').props.taskList).toEqual([goalTask])
        act(() => tree.unmount())
    })

    it.each(['template', 'assistant', 'organize'])(
        'keeps the existing composer restriction for %s boards',
        async mode => {
            setBoard({ mainTasks: [], emptyGoals: [] })
            delete mockStoreState.doneMilestonesByProjectInTasks[PROJECT]
            if (mode === 'template') mockStoreState.loggedUser.templateProjectIds = [PROJECT]
            if (mode === 'assistant') mockStoreState.currentUser.temperature = 0.7
            let tree
            await act(async () => {
                tree = renderer.create(React.cloneElement(element(), { isActiveOrganizeMode: mode === 'organize' }))
            })
            expect(tree.root.findAllByType('NewTaskSection')).toHaveLength(0)
            act(() => tree.unmount())
        }
    )

    it('does not expose a composer when project access is denied', async () => {
        setBoard({ mainTasks: [], emptyGoals: [] })
        delete mockStoreState.doneMilestonesByProjectInTasks[PROJECT]
        SharedHelper.checkIfUserHasAccessToProject.mockReturnValue(false)
        let tree
        try {
            await act(async () => {
                tree = renderer.create(element())
            })
            expect(tree.root.findAllByType('NewTaskSection')).toHaveLength(0)
        } finally {
            act(() => tree?.unmount())
            SharedHelper.checkIfUserHasAccessToProject.mockReturnValue(true)
        }
    })
})

describe('the board deciding a goal has left today (AT-2521)', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener
    const originalNodeEnv = process.env.NODE_ENV

    beforeEach(() => {
        jest.useFakeTimers()
        resetGoalTaskCompletionListeners()
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
        AccessibilityInfo.addEventListener = jest.fn(() => ({ remove: jest.fn() }))
        // The exit stands down under jest's inert-animation convention and under reduced motion, so
        // without opting out of both every assertion here would pass against a hook that had
        // correctly decided to do nothing.
        process.env.NODE_ENV = 'development'
    })

    afterEach(() => {
        jest.useRealTimers()
        AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled
        AccessibilityInfo.addEventListener = originalAddEventListener
        process.env.NODE_ENV = originalNodeEnv
    })

    const mount = async board => {
        setBoard(board)
        let tree
        await act(async () => {
            tree = renderer.create(element())
            await Promise.resolve()
        })
        return tree
    }

    const update = async (tree, board) => {
        setBoard(board)
        await act(async () => {
            tree.update(element())
            await Promise.resolve()
        })
    }

    const complete = async (taskId, goalId) => {
        await act(async () => {
            publishGoalTaskCompletion({ projectId: PROJECT, goalId, taskId })
        })
    }
    const postpone = async (taskId, goalId) => {
        await act(async () => {
            publishGoalTaskPostpone({ projectId: PROJECT, goalId, taskId })
        })
    }

    const sectionsOf = tree => tree.root.findAllByType('ParentGoalSection').map(node => node.props)
    const emptyGoalsOf = tree => tree.root.findAllByType('EmptyGoal').map(node => node.props)
    const generalEntriesOf = tree => tree.root.findAllByType('GeneralTaskSectionEntry').map(node => node.props)

    describe('a goal shown ONLY because one of its tasks is due today', () => {
        const withTask = { mainTasks: [[TASK_ONLY_GOAL, [task('t1')]]], emptyGoals: [] }

        it('is on the board while the task is', async () => {
            const tree = await mount(withTask)

            expect(sectionsOf(tree).map(props => props.goalId)).toEqual([TASK_ONLY_GOAL])
            expect(sectionsOf(tree)[0].postponeMotionEnabled).toBe(true)
        })

        /**
         * The single-step departure, and the one the reported behaviour is about. The goal is not
         * active for today in its own right, so when its task goes there is nothing left to keep it
         * and it leaves the day outright.
         */
        it('is kept on the board wearing an exit when that task is completed', async () => {
            const tree = await mount(withTask)

            await complete('t1', TASK_ONLY_GOAL)
            await update(tree, { mainTasks: [], emptyGoals: [] })

            const held = sectionsOf(tree)
            expect(held).toHaveLength(1)
            expect(held[0].goalId).toBe(TASK_ONLY_GOAL)
            expect(held[0].exitRunId).toBeGreaterThan(0)
            // The completed row itself must not come back for the length of the hold.
            expect(held[0].taskList).toEqual([])
        })

        it('starts revealing the general add-task row while that final goal is collapsing', async () => {
            const tree = await mount(withTask)

            await complete('t1', TASK_ONLY_GOAL)
            await update(tree, { mainTasks: [], emptyGoals: [] })

            const entries = generalEntriesOf(tree)
            expect(entries).toHaveLength(1)
            expect(entries[0].entryRunId).toBeGreaterThan(0)
            const creators = tree.root.findAllByType('NewTaskSection')
            expect(creators).toHaveLength(1)
            expect(creators[0].props.suspendShortcut).toBe(true)
        })

        it('animates the parent section and entry row after its final task is postponed', async () => {
            const tree = await mount(withTask)

            await postpone('t1', TASK_ONLY_GOAL)
            await update(tree, { mainTasks: [], emptyGoals: [] })

            expect(sectionsOf(tree)).toHaveLength(1)
            expect(sectionsOf(tree)[0].goalId).toBe(TASK_ONLY_GOAL)
            expect(sectionsOf(tree)[0].exitRunId).toBeGreaterThan(0)
            expect(sectionsOf(tree)[0].taskList).toEqual([])
            expect(generalEntriesOf(tree)).toHaveLength(1)
            expect(generalEntriesOf(tree)[0].entryRunId).toBeGreaterThan(0)
        })

        it('does not reveal a general creator while another goal section remains', async () => {
            const tree = await mount({
                mainTasks: [
                    [TASK_ONLY_GOAL, [task('t1')]],
                    [REMINDER_GOAL, [task('t2')]],
                ],
                emptyGoals: [],
            })

            await complete('t1', TASK_ONLY_GOAL)
            await update(tree, { mainTasks: [[REMINDER_GOAL, [task('t2')]]], emptyGoals: [] })

            expect(
                sectionsOf(tree)
                    .map(props => props.goalId)
                    .sort()
            ).toEqual([TASK_ONLY_GOAL, REMINDER_GOAL].sort())
            expect(generalEntriesOf(tree)).toHaveLength(0)
        })

        it('is finally gone once the exit has played', async () => {
            const tree = await mount(withTask)
            await complete('t1', TASK_ONLY_GOAL)
            await update(tree, { mainTasks: [], emptyGoals: [] })

            await act(async () => {
                jest.advanceTimersByTime(4000)
            })

            expect(sectionsOf(tree)).toHaveLength(0)
        })

        it('still leaves instantly when its task was moved or deleted rather than completed', async () => {
            const tree = await mount(withTask)

            await update(tree, { mainTasks: [], emptyGoals: [] })

            expect(sectionsOf(tree)).toHaveLength(0)
            expect(generalEntriesOf(tree)).toHaveLength(1)
            expect(generalEntriesOf(tree)[0].entryRunId).toBe(0)
        })
    })

    describe('a goal that has its own reminder for today', () => {
        const withTask = { mainTasks: [[REMINDER_GOAL, [task('t1')]]], emptyGoals: [] }
        const cleared = { mainTasks: [], emptyGoals: [goalDoc(REMINDER_GOAL)] }

        /**
         * It STAYS, and it is not animated: the row is not leaving, it is turning into its
         * empty-goal form with an add-task line under it. Fading it out here would dim a row that
         * is about to be redrawn.
         */
        it('stays as an empty-goal row when its last task is completed, with no exit', async () => {
            const tree = await mount(withTask)

            await complete('t1', REMINDER_GOAL)
            await update(tree, cleared)

            const rows = emptyGoalsOf(tree)
            expect(rows).toHaveLength(1)
            expect(rows[0].goal.id).toBe(REMINDER_GOAL)
            expect(rows[0].exitRunId).toBe(0)
            expect(sectionsOf(tree)).toHaveLength(0)
        })

        /**
         * And when it does leave — the goal itself reached 100%, so it stops being active for today
         * — the exit plays on THAT row. This is the ordinary production ordering: the tasks
         * snapshot lands before the goal snapshot, so this is the state the goal leaves from.
         */
        it('wears the exit on that same row once the goal itself leaves the day', async () => {
            const tree = await mount(withTask)

            await complete('t1', REMINDER_GOAL)
            await update(tree, cleared)
            await update(tree, { mainTasks: [], emptyGoals: [] })

            const rows = emptyGoalsOf(tree)
            expect(rows).toHaveLength(1)
            expect(rows[0].goal.id).toBe(REMINDER_GOAL)
            expect(rows[0].exitRunId).toBeGreaterThan(0)
            // Held where it already was, so the mounted and measured row is the one that animates.
            expect(sectionsOf(tree)).toHaveLength(0)
            expect(generalEntriesOf(tree)).toHaveLength(1)
            expect(generalEntriesOf(tree)[0].entryRunId).toBeGreaterThan(0)
        })

        it('is finally gone once that exit has played', async () => {
            const tree = await mount(withTask)
            await complete('t1', REMINDER_GOAL)
            await update(tree, cleared)
            await update(tree, { mainTasks: [], emptyGoals: [] })

            await act(async () => {
                jest.advanceTimersByTime(4000)
            })

            expect(emptyGoalsOf(tree)).toHaveLength(0)
        })
    })

    /**
     * A goal that reached 100% is refused a position by the BACKLOG branch of
     * `sortGoalTasksGorups`, and `MainSection` drops a section whose goal has no position. Without
     * `keepDepartingGoalsSortable` the exit would be computed, handed over, and silently discarded
     * before it could be drawn — the same end result as never having animated at all.
     */
    describe('a departing goal that lives in the backlog', () => {
        const backlogGoal = () => ({
            ...goalDoc(TASK_ONLY_GOAL),
            // Past the real milestone's date, so only the synthetic backlog milestone can hold it
            // — and that is the one branch of the sort that checks progress.
            startingMilestoneDate: MILESTONE.date + 1,
            completionMilestoneDate: Number.MAX_SAFE_INTEGER,
            progress: 100,
            dynamicProgress: 100,
        })

        const boardWith = board => {
            setBoard(board)
            mockStoreState.goalsByProjectInTasks[PROJECT][TASK_ONLY_GOAL] = backlogGoal()
        }

        it('keeps its place on the board for the exit instead of being dropped as orphaned', async () => {
            boardWith({ mainTasks: [[TASK_ONLY_GOAL, [task('t1')]]], emptyGoals: [] })
            let tree
            await act(async () => {
                tree = renderer.create(element())
                await Promise.resolve()
            })

            await complete('t1', TASK_ONLY_GOAL)
            boardWith({ mainTasks: [], emptyGoals: [] })
            await act(async () => {
                tree.update(element())
                await Promise.resolve()
            })

            const held = sectionsOf(tree)
            expect(held).toHaveLength(1)
            expect(held[0].exitRunId).toBeGreaterThan(0)
        })
    })
})
