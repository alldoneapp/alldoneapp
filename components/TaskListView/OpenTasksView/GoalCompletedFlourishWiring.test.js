import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { AccessibilityInfo } from 'react-native'

/**
 * AT-2507 — the CHAIN, end to end: a task row announcing its completion must end in a flourish
 * painted on the real goal row above it.
 *
 * `useGoalCompletedFlourish.test.js` pins the rule, `GoalCompletedFlourish.test.js` pins what is
 * drawn and how it ranks against the bigger celebrations, and `taskCompletionMotion.test.js` pins
 * which ticks are announced at all. None of them would notice the one failure that matters most in
 * practice: a prop that stops being threaded somewhere along
 *
 *     MainSection → ParentGoalSection → GoalItem → GoalItemPresentation → GoalCompletedFlourish
 *
 * five components, four of which have nothing to do with animation. That is the AT-2454 lesson —
 * the row rendered nothing and every unit test stayed green — so this suite renders the REAL
 * `ParentGoalSection` with the REAL goal row inside it and publishes REAL completion events.
 *
 * Motion is inert under jest by convention and stands down under reduced motion, so this opts out
 * of both; otherwise the flourish correctly draws nothing and every assertion here passes
 * vacuously.
 */

jest.mock('react-native-gesture-handler/Swipeable', () =>
    require('../TaskItem/TaskPresentation/__swipeableAnimateRowDouble')
)
jest.mock('uuid/v4', () => {
    let counter = 0
    return () => `watcher-${++counter}`
})

const mockStoreState = {
    currentUser: { uid: 'logged-user' },
    loggedUser: { uid: 'logged-user', isAnonymous: false, unlockedKeysByGuides: [] },
    isMiddleScreen: false,
    smallScreenNavigation: false,
    dismissibleActive: false,
    activeEditMode: false,
    activeDragGoalMode: null,
    subtaskByTaskStore: {},
    goalsByProjectInTasks: {},
    optimisticGoalPostpones: {},
}

jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: {
        getState: () => mockStoreState,
        dispatch: jest.fn(),
        subscribe: () => () => {},
    },
}))
jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockStoreState),
    useDispatch: () => jest.fn(),
    shallowEqual: (a, b) => a === b,
    // `@hello-pangea/dnd` reads `connect` at module scope, and it is reached from this tree through
    // `DismissibleItem` → `HelperFunctions` → the settings barrel. Omitting it fails the whole
    // suite at import time, several files away from anything under test.
    connect: () => Component => Component,
    Provider: ({ children }) => children,
    batch: fn => fn(),
}))
jest.mock('../../../redux/actions', () => ({
    hideFloatPopup: jest.fn(() => ({ type: 'HIDE_FLOAT_POPUP' })),
    showFloatPopup: jest.fn(() => ({ type: 'SHOW_FLOAT_POPUP' })),
    setGoalSwipeMilestoneModalOpen: jest.fn(() => ({ type: 'NOOP' })),
    showSwipeDueDatePopup: jest.fn(() => ({ type: 'NOOP' })),
    setSwipeDueDatePopupData: jest.fn(() => ({ type: 'NOOP' })),
    setSelectedNavItem: jest.fn(() => ({ type: 'NOOP' })),
    setDismissibleComponent: jest.fn(() => ({ type: 'NOOP' })),
    toggleDismissibleActive: jest.fn(() => ({ type: 'NOOP' })),
    unsetAddTaskRepeatMode: jest.fn(() => ({ type: 'NOOP' })),
}))
jest.mock('../../../utils/backends/firestore', () => ({ watchGoalLinkedOpenTasksAmount: jest.fn() }))
jest.mock('../../../utils/NavigationService', () => ({ __esModule: true, default: { navigate: jest.fn() } }))
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {
        // Indexed into PROJECT_COLOR_SYSTEM by the row, so it has to be a real key — an arbitrary
        // string reads back `undefined` and takes the render down.
        getProjectColorById: () => require('../../../Themes/Modern/ProjectColors').PROJECT_COLOR_DEFAULT,
        checkIfLoggedUserIsNormalUserInGuide: () => false,
    },
}))
jest.mock('../../Guides/guidesHelper', () => ({ objectIsLockedForUser: () => false }))
jest.mock('../Utils/TasksHelper', () => ({ BACKLOG_DATE_NUMERIC: Number.MAX_SAFE_INTEGER }))
jest.mock('../../GoalsView/GoalsHelper', () => ({ DYNAMIC_PERCENT: 'DYNAMIC_PERCENT' }))

// Everything below the goal row. None of it decides whether the flourish plays, and every one of
// them drags in Firebase or the editor if left real. `GoalCompletedFlourish` is deliberately NOT
// among them — it is the thing under test.
jest.mock('./TasksList', () => 'TasksList')
jest.mock('./NewTaskSection', () => 'NewTaskSection')
jest.mock('../../GoalsView/SortModeActiveInfo', () => 'SortModeActiveInfo')
jest.mock('../GoalIndicator', () => 'GoalIndicator')
jest.mock('../../UIComponents/FloatModals/LockedGoalModal/LockedGoalModal', () => 'LockedGoalModal')
jest.mock('../../GoalsView/EditGoal', () => 'EditGoal')
jest.mock('../../GoalsView/GoalProgressWrapper', () => 'GoalProgressWrapper')
jest.mock('../../GoalsView/GoalProgressBar', () => 'GoalProgressBar')
jest.mock('../../GoalsView/GoalDoneProgressBar', () => 'GoalDoneProgressBar')
jest.mock('../../GoalsView/GoalsSwipeBackground', () => 'GoalsSwipeBackground')
jest.mock('../../GoalsView/GoalSwipeDateRangeWrapper', () => 'GoalSwipeDateRangeWrapper')
jest.mock('../../GoalsView/GoalItemTagsArea', () => 'GoalItemTagsArea')
jest.mock('../../GoalsView/GoalItemAssigneesArea', () => 'GoalItemAssigneesArea')
jest.mock('../../Tags/TaskSummarizeTags', () => 'TaskSummarizeTags')
jest.mock('../../UIControls/SocialText/SocialText', () => 'SocialText')
jest.mock('../../Icon', () => 'Icon')

const mockWatchGoal = jest.fn()
jest.mock('../../../utils/BackendBridge', () => ({
    __esModule: true,
    default: {
        watchGoal: (...args) => mockWatchGoal(...args),
        unwatch: jest.fn(),
        watchBacklinksCount: jest.fn(),
        watchOpenMilestonesInDateRange: jest.fn(),
        unwatchBacklinksCount: jest.fn(),
    },
}))

import ParentGoalSection from './ParentGoalSection'
import { publishGoalTaskCompletion, resetGoalTaskCompletionListeners } from './goalCompletionSignal'
import { GOAL_FLOURISH_TOTAL_MS } from './goalCompletedFlourishMotion'

const PROJECT = 'project-1'
const GOAL = 'goal-1'

const goalDoc = {
    id: GOAL,
    extendedName: 'Ship the thing',
    ownerId: 'logged-user',
    lockKey: null,
    hasStar: '#FFFFFF',
    assigneesIds: [],
    assigneesCapacity: {},
    assigneesReminderDate: { 'logged-user': Date.now() },
    progress: 40,
    dynamicProgress: 40,
    progressByDoneMilestone: {},
    startingMilestoneDate: Date.now(),
    completionMilestoneDate: Date.now(),
    dateByDoneMilestone: {},
    parentDoneMilestoneIds: [],
    isPublicFor: ['all'],
    commentsData: null,
    description: '',
    noteId: null,
    inDoneMilestone: false,
}

const task = id => ({ id, dueDate: Date.now() })

const flourishOf = tree => tree.root.findAllByProps({ testID: 'goal-completed-flourish' }, { deep: false })[0]

const renderSection = async ({ taskList, celebrateCompletion = true }) => {
    let tree
    await act(async () => {
        tree = renderer.create(
            <ParentGoalSection
                projectId={PROJECT}
                dateIndex={0}
                goalId={GOAL}
                taskList={taskList}
                taskListIndex={3}
                instanceKey={'instance-1'}
                inMainSection={true}
                goalIndex={0}
                amountToRender={taskList.length}
                celebrateCompletion={celebrateCompletion}
            />
        )
        await Promise.resolve()
    })
    // The goal document arrives from its own live listener, exactly as it does in the app.
    await act(async () => {
        mockWatchGoal.mock.calls[mockWatchGoal.mock.calls.length - 1][3](goalDoc)
        await Promise.resolve()
    })
    return tree
}

const complete = taskId =>
    act(() => {
        publishGoalTaskCompletion({ projectId: PROJECT, goalId: GOAL, taskId })
    })

describe('the goal flourish, wired end to end (AT-2507)', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener
    const originalNodeEnv = process.env.NODE_ENV

    beforeEach(() => {
        jest.useFakeTimers()
        mockWatchGoal.mockClear()
        resetGoalTaskCompletionListeners()
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
        AccessibilityInfo.addEventListener = jest.fn(() => ({ remove: jest.fn() }))
        process.env.NODE_ENV = 'development'
    })

    afterEach(() => {
        jest.useRealTimers()
        AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled
        AccessibilityInfo.addEventListener = originalAddEventListener
        process.env.NODE_ENV = originalNodeEnv
    })

    it('paints nothing on a goal that still has work on it', async () => {
        const tree = await renderSection({ taskList: [task('t1'), task('t2')] })

        expect(flourishOf(tree)).toBeUndefined()

        await complete('t1')

        expect(flourishOf(tree)).toBeUndefined()
    })

    it('paints the flourish on the real goal row when its last task is completed', async () => {
        const tree = await renderSection({ taskList: [task('t1'), task('t2')] })

        await complete('t1')
        await complete('t2')

        expect(flourishOf(tree)).toBeDefined()
    })

    it('hands the row back exactly as it found it', async () => {
        // The goal usually STAYS on the board after being cleared — as an `EmptyGoal` with its
        // add-task line — so a bar left behind here would be permanent.
        const tree = await renderSection({ taskList: [task('t1')] })

        await complete('t1')
        expect(flourishOf(tree)).toBeDefined()

        await act(async () => {
            jest.advanceTimersByTime(GOAL_FLOURISH_TOTAL_MS + 200)
        })

        expect(flourishOf(tree)).toBeUndefined()
    })

    it('stays silent on a section that may not celebrate', async () => {
        // What `MainSection` passes for a non-today date section, a filtered list, somebody else's
        // board, or an assistant profile board.
        const tree = await renderSection({ taskList: [task('t1')], celebrateCompletion: false })

        await complete('t1')

        expect(flourishOf(tree)).toBeUndefined()
    })

    it('paints in the goal row own accent rather than the task green', async () => {
        // Green is the app's statement about a TASK being done, and it lands on the task row a beat
        // earlier; reusing it here would make the two moments read as one.
        const tree = await renderSection({ taskList: [task('t1')] })
        await complete('t1')

        const bar = tree.root.findAllByProps({ testID: 'goal-completed-flourish-bar' }, { deep: false })[0]
        const style = Object.assign({}, ...[].concat(bar.props.style).filter(Boolean))
        const { PROJECT_COLOR_SYSTEM, PROJECT_COLOR_DEFAULT } = require('../../../Themes/Modern/ProjectColors')

        expect(style.backgroundColor).toBe(PROJECT_COLOR_SYSTEM[PROJECT_COLOR_DEFAULT].PROJECT_ITEM_ACTIVE)
    })
})
