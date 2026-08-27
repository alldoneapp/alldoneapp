import React from 'react'
import renderer, { act } from 'react-test-renderer'

/**
 * AT-2449 follow-up — swiping a GOAL row must open the postpone popup, not the goal.
 *
 * `hooks/useSwipeCloseGuard.test.js` pins the RULE and
 * `components/TaskListView/TaskItem/TaskPresentation/TaskPresentationSwipeGuard.test.js` pins the
 * task row's wiring. The goal row needs its own suite because it is the one that actually SHOWED
 * the follow-up defect, and it shows it for a reason the task row structurally cannot: it defers
 * its popup.
 *
 * A mouse drag ends with `mouseup` AND a trailing `click` at the release point — i.e. on the row
 * that was just swiped. `GoalItemPresentation.onRightSwipe` closes the row and then schedules the
 * `showSwipeDueDatePopup` dispatch on a `setTimeout`, so if that trailing click is allowed through
 * it opens goal edit mode, the row unmounts, and `componentWillUnmount` clears `this.timeouts` —
 * cancelling the very popup the swipe asked for. The task row never showed this because
 * `TaskPresentation.onRightSwipe` dispatches synchronously.
 *
 * So the row must be blocked for the REST OF THE GESTURE and released on the next macrotask. Both
 * halves are the test: blocked-forever was the original AT-2449 bug (a permanently unclickable
 * row), never-blocked is this follow-up.
 *
 * The Swipeable double is shared with the task suite and is not a convenience stub — it reproduces
 * `_animateRow`'s callback ORDER and the batched `rowState` write that makes a programmatic
 * `close()` have nothing to animate. See `__swipeableAnimateRowDouble.js`.
 */

jest.mock('react-native-gesture-handler/Swipeable', () =>
    require('../TaskListView/TaskItem/TaskPresentation/__swipeableAnimateRowDouble')
)
jest.mock('uuid/v4', () => {
    let counter = 0
    return () => `watcher-${++counter}`
})
jest.mock('../../redux/store', () => ({
    getState: () => ({
        currentUser: { uid: 'logged-user' },
        loggedUser: { uid: 'logged-user', isAnonymous: false, unlockedKeysByGuides: [] },
        isMiddleScreen: false,
        smallScreenNavigation: false,
    }),
    dispatch: jest.fn(),
    subscribe: () => () => {},
}))
jest.mock('../../redux/actions', () => ({
    hideFloatPopup: jest.fn(() => ({ type: 'HIDE_FLOAT_POPUP' })),
    showFloatPopup: jest.fn(() => ({ type: 'SHOW_FLOAT_POPUP' })),
    setGoalSwipeMilestoneModalOpen: jest.fn(() => ({ type: 'SET_GOAL_SWIPE_MILESTONE_MODAL_OPEN' })),
    showSwipeDueDatePopup: jest.fn(() => ({ type: 'SHOW_SWIPE_DUE_DATE_POPUP' })),
    setSwipeDueDatePopupData: jest.fn(() => ({ type: 'SET_SWIPE_DUE_DATE_POPUP_DATA' })),
    setSelectedNavItem: jest.fn(() => ({ type: 'SET_SELECTED_NAV_ITEM' })),
}))
jest.mock('../../utils/backends/firestore', () => ({ watchGoalLinkedOpenTasksAmount: jest.fn() }))
jest.mock('../../utils/BackendBridge', () => ({
    __esModule: true,
    default: {
        watchBacklinksCount: jest.fn(),
        watchOpenMilestonesInDateRange: jest.fn(),
        unwatch: jest.fn(),
        unwatchBacklinksCount: jest.fn(),
    },
}))
jest.mock('../../utils/NavigationService', () => ({ __esModule: true, default: { navigate: jest.fn() } }))
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {
        // The row indexes PROJECT_COLOR_SYSTEM with whatever this returns, so it has to be a real
        // key — an arbitrary string reads back `undefined` and takes the render down.
        getProjectColorById: () => require('../../Themes/Modern/ProjectColors').PROJECT_COLOR_DEFAULT,
        checkIfLoggedUserIsNormalUserInGuide: () => false,
    },
}))
jest.mock('../Guides/guidesHelper', () => ({ objectIsLockedForUser: () => false }))
// Constants only, and they carry their REAL values — the row branches on both
// (`completionMilestoneDate === BACKLOG_DATE_NUMERIC`, `progress === DYNAMIC_PERCENT`), so a stubbed
// value would quietly send the render down a branch the app never takes.
jest.mock('../TaskListView/Utils/TasksHelper', () => ({ BACKLOG_DATE_NUMERIC: Number.MAX_SAFE_INTEGER }))
jest.mock('./GoalsHelper', () => ({ DYNAMIC_PERCENT: 'DYNAMIC_PERCENT' }))
// Leaf children become host strings: none of them decide whether a press is accepted, and every
// one of them drags in the store, Firebase or the editor if left real.
jest.mock('./GoalProgressWrapper', () => 'GoalProgressWrapper')
jest.mock('./GoalProgressBar', () => 'GoalProgressBar')
jest.mock('./GoalDoneProgressBar', () => 'GoalDoneProgressBar')
jest.mock('./GoalsSwipeBackground', () => 'GoalsSwipeBackground')
jest.mock('./GoalSwipeDateRangeWrapper', () => 'GoalSwipeDateRangeWrapper')
jest.mock('./GoalItemTagsArea', () => 'GoalItemTagsArea')
jest.mock('./GoalItemAssigneesArea', () => 'GoalItemAssigneesArea')
jest.mock('../Tags/TaskSummarizeTags', () => 'TaskSummarizeTags')
jest.mock('../UIControls/SocialText/SocialText', () => 'SocialText')
jest.mock('../Icon', () => 'Icon')

import { TouchableOpacity } from 'react-native'
import GoalItemPresentation from './GoalItemPresentation'
import {
    RIGHT_ACTIONS_WIDTH,
    swipeableInstances,
} from '../TaskListView/TaskItem/TaskPresentation/__swipeableAnimateRowDouble'
import store from '../../redux/store'
import { showSwipeDueDatePopup } from '../../redux/actions'

const baseGoal = {
    id: 'goal-1',
    extendedName: 'Ship the thing',
    ownerId: 'logged-user',
    lockKey: null,
    hasStar: '#FFFFFF',
    assigneesIds: [],
    assigneesCapacity: {},
    assigneesReminderDate: { 'logged-user': Date.now() },
    progress: 0,
    dynamicProgress: 0,
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

const parentGoaltasks = [{ id: 'task-1', dueDate: Date.now() }]

const renderRow = async onPress => {
    let tree
    await act(async () => {
        tree = renderer.create(
            <GoalItemPresentation
                projectId={'project-1'}
                goal={baseGoal}
                inParentGoal={true}
                parentGoaltasks={parentGoaltasks}
                onPress={onPress}
            />
        )
        await Promise.resolve()
    })
    return tree
}

// The row gates presses in exactly one place, so read that place rather than component state:
// `onPress={!blockAction ? onPress : undefined}` + `disabled={blockAction}`. Asserting the two
// agree is what keeps this honest — a lookup that drifted onto some other node would report
// `undefined` for both and quietly answer "not blocked" forever.
const isBlocked = tree => {
    const pressTarget = tree.root.findByType(TouchableOpacity)
    expect(pressTarget.props.disabled).toBe(pressTarget.props.onPress === undefined)
    return pressTarget.props.disabled
}

const pressHandlerOf = tree => tree.root.findByType(TouchableOpacity).props.onPress

describe('GoalItemPresentation swipe close guard (AT-2449)', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        swipeableInstances.length = 0
        store.dispatch.mockClear()
        showSwipeDueDatePopup.mockClear()
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('blocks the row for the rest of the swipe turn, then releases it', async () => {
        const onPress = jest.fn()
        const tree = await renderRow(onPress)
        const swipeable = swipeableInstances[0]

        expect(isBlocked(tree)).toBe(false)
        // The node being read really is the row's press target, not some other touchable.
        expect(pressHandlerOf(tree)).toBe(onPress)

        // The gesture the user makes: drag left past the threshold and let go.
        act(() => {
            swipeable.releaseRightSwipe()
        })

        // This ordering IS the defect. `_animateRow(0, -width)` calls the app's handler, which
        // closes the row from inside it; that close has nothing to travel (the `rowState` write is
        // still batched) so its spring settles inside `.start()` and reports "closed" BEFORE
        // "will close".
        expect(swipeable.emitted).toEqual([
            'onSwipeableRightWillOpen',
            'onSwipeableClose',
            'onSwipeableWillClose',
            'onSwipeableWillOpen',
        ])

        // Where the browser's trailing click lands. Letting it through opens goal edit mode, which
        // unmounts the row and clears the pending popup timeout.
        expect(isBlocked(tree)).toBe(true)

        // The gesture is over by the first macrotask after it, so the block must be gone by then —
        // leaving it set is the original AT-2449 symptom, a row nobody can click again.
        act(() => {
            jest.runOnlyPendingTimers()
        })
        expect(isBlocked(tree)).toBe(false)
        expect(pressHandlerOf(tree)).toBe(onPress)
    })

    it('opens the postpone popup the swipe asked for', async () => {
        const tree = await renderRow(jest.fn())
        const swipeable = swipeableInstances[0]

        act(() => {
            swipeable.releaseRightSwipe()
        })

        // Deferred by `onRightSwipe`, so nothing has been asked for yet.
        expect(showSwipeDueDatePopup).not.toHaveBeenCalled()

        act(() => {
            jest.runOnlyPendingTimers()
        })

        expect(showSwipeDueDatePopup).toHaveBeenCalled()
        const dispatched = store.dispatch.mock.calls.map(call => call[0]).flat()
        expect(dispatched).toContainEqual({ type: 'SHOW_SWIPE_DUE_DATE_POPUP' })
        expect(isBlocked(tree)).toBe(false)
    })

    it('still blocks the press that closes a row the user left open', async () => {
        const tree = await renderRow(jest.fn())
        const swipeable = swipeableInstances[0]

        // A row sitting open: closing it has real distance to travel, so the spring resolves in a
        // later frame and the pair arrives in the order the original two-line pattern assumed.
        act(() => swipeable.forceOpen(-RIGHT_ACTIONS_WIDTH))
        act(() => swipeable.close())
        expect(isBlocked(tree)).toBe(true)

        act(() => swipeable.settleClose())
        expect(isBlocked(tree)).toBe(false)
    })
})
