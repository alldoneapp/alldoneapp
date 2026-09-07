import React from 'react'
import renderer, { act } from 'react-test-renderer'

/**
 * AT-2507 — the goal section actually WEARING its exit.
 *
 * `useGoalSectionExit.test.js` pins which departures qualify and `goalSectionExitMotion.test.js`
 * pins the shape of the style. Neither would notice the failure that matters most in practice: the
 * style being computed correctly and then not reaching the node — a wrapper that stayed a plain
 * `View` (which renders an interpolation once through `toString()` and never updates again), a
 * `sectionStyle` dropped from the style array, or a `minHeight` floor left in front of it. That is
 * the AT-2454 lesson: the row rendered nothing and every unit test stayed green.
 *
 * So this renders the REAL `ParentGoalSection` and reads the props the real wrapper node ends up
 * with. Motion is inert under jest by convention and the hook stands down under reduced motion, so
 * this opts out of both — otherwise every assertion here passes vacuously.
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

// Everything inside the section. None of it decides whether the exit plays, and every one of them
// drags in Firebase or the editor if left real. The section's own wrapper is deliberately NOT
// mocked — it is the thing under test.
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

import { AccessibilityInfo, Animated } from 'react-native'
import ParentGoalSection from './ParentGoalSection'

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

const SECTION_HEIGHT = 184

/**
 * The section's own wrapper: the outermost node `ParentGoalSection` renders, identified by the
 * `onLayout` handler it is the only node to carry. Looked up that way rather than by index so a
 * future wrapper added around it cannot silently move the assertions onto the wrong node.
 */
const wrapperOf = tree => tree.root.findAll(node => node.type === Animated.View && !!node.props.onLayout)[0]

const flatStyleOf = node => Object.assign({}, ...[].concat(node.props.style).filter(Boolean))

const renderSection = async ({ exitRunId = 0, measure = true } = {}) => {
    let tree
    await act(async () => {
        tree = renderer.create(
            <ParentGoalSection
                projectId={PROJECT}
                dateIndex={0}
                goalId={GOAL}
                taskList={[]}
                taskListIndex={3}
                instanceKey={'instance-1'}
                inMainSection={true}
                goalIndex={0}
                amountToRender={0}
                exitRunId={exitRunId}
            />
        )
        await Promise.resolve()
    })
    // The goal document arrives from its own live listener, exactly as it does in the app.
    await act(async () => {
        mockWatchGoal.mock.calls[mockWatchGoal.mock.calls.length - 1][3](goalDoc)
        await Promise.resolve()
    })
    if (measure) {
        // jsdom lays nothing out, so the measurement the wrapper gets from `onLayout` in a browser
        // has to be handed over by hand — without it the collapse has no height to collapse from.
        await act(async () => {
            wrapperOf(tree).props.onLayout({ nativeEvent: { layout: { height: SECTION_HEIGHT, width: 600 } } })
        })
    }
    return tree
}

const startExit = async tree => {
    await act(async () => {
        tree.update(
            <ParentGoalSection
                projectId={PROJECT}
                dateIndex={0}
                goalId={GOAL}
                taskList={[]}
                taskListIndex={3}
                instanceKey={'instance-1'}
                inMainSection={true}
                goalIndex={0}
                amountToRender={0}
                exitRunId={1}
            />
        )
        await Promise.resolve()
    })
}

describe('a goal section wearing its exit (AT-2507)', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener
    const originalNodeEnv = process.env.NODE_ENV

    beforeEach(() => {
        jest.useFakeTimers()
        mockWatchGoal.mockClear()
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

    it('leaves an ordinary section completely untouched', async () => {
        const tree = await renderSection()
        const style = flatStyleOf(wrapperOf(tree))

        expect(style.opacity).toBeUndefined()
        expect(style.height).toBeUndefined()
        expect(style.overflow).toBeUndefined()
        expect(style.pointerEvents).toBeUndefined()
    })

    /**
     * The wrapper MUST be an `Animated.View`. Handed the same style, a plain `View` resolves the
     * interpolations once through `toString()` and then never updates — the section would take the
     * first frame of the exit and freeze there, with every other assertion in this file still green.
     */
    it('is animatable, not a plain View', async () => {
        const tree = await renderSection()

        expect(wrapperOf(tree)).toBeDefined()
    })

    it('wears the exit style once it is leaving', async () => {
        const tree = await renderSection()
        await startExit(tree)

        const style = flatStyleOf(wrapperOf(tree))
        expect(style.overflow).toBe('hidden')
        expect(style.opacity).toBeDefined()
        expect(style.height).toBeDefined()
        expect(style.transform).toHaveLength(1)
    })

    it('stops accepting taps on its way out', async () => {
        // Everything in the block — the goal row, its add-task line — is about to cease to exist,
        // and it is fading under the pointer. Carried in the style rather than as a prop, because
        // react-native-web 0.21 deprecates the prop form and warns.
        const tree = await renderSection()
        await startExit(tree)

        expect(flatStyleOf(wrapperOf(tree)).pointerEvents).toBe('none')
    })

    it('puts the exit style LAST, so no earlier floor can outrank it', async () => {
        const tree = await renderSection()
        await startExit(tree)

        const styles = [].concat(wrapperOf(tree).props.style).filter(Boolean)
        expect(styles[styles.length - 1].height).toBeDefined()
    })

    it('stands down under reduced motion', async () => {
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))
        const tree = await renderSection()

        await startExit(tree)

        const style = flatStyleOf(wrapperOf(tree))
        expect(style.opacity).toBeUndefined()
        expect(style.height).toBeUndefined()
        expect(style.pointerEvents).toBeUndefined()
    })
})
