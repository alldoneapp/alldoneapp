/**
 * AT-2449 browser regression harness — entry point.
 *
 * "After swiping left on a task and then dismissing the postpone popup by
 *  clicking next to it, I can no longer click into the task in the task list view"
 *
 * This cannot be reproduced in Jest. The defect lives in how three real things
 * compose — react-native-gesture-handler's `Swipeable` (a Hammer.js pan on web),
 * the vendored `react-tiny-popover`'s window-level outside-click detection, and
 * react-native-web's `Touchable` press path — and jsdom has no layout, no
 * pointer-event pipeline and no Hammer recognisers, so a swipe simply cannot
 * happen there. Every jsdom test of this path would necessarily call the handlers
 * by hand, which is exactly the step that hides the bug.
 *
 * The harness mounts the REAL `TaskItem` (and through it `DismissibleItem`,
 * `TaskPresentationContainer`, `TaskPresentation`, the real `Swipeable`,
 * `TitleContainer`/`SocialText`) next to the REAL `GlobalModalsContainerRootView`,
 * which is what mounts the REAL `DueDateSinglePopup` off the real redux flag —
 * i.e. exactly the composition `RootView` renders in the app.
 *
 * `run.js` then drives a real left-swipe with the real mouse, dismisses the popup
 * with a real click next to it, and clicks the task title — asserting on whether
 * edit mode opens.
 */
import 'setimmediate'
import React from 'react'
import { View } from 'react-native'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'

import store from '../../redux/store'
import { initFirebase } from '../../utils/backends/firestore'
import CustomScrollView from '../../components/UIControls/CustomScrollView'
import TaskItem from '../../components/TaskListView/TaskItem'
import GlobalModalsContainerRootView from '../../components/UIComponents/GlobalModalsContainerRootView'
import { OPEN_STEP, RECURRENCE_NEVER, TASK_ASSIGNEE_USER_TYPE } from '../../components/TaskListView/Utils/TasksHelper'
import { TASK_PRIORITY_NONE } from '../../utils/TaskPriority'
import { ESTIMATION_0_MIN } from '../../utils/EstimationHelper'
import { FEED_PUBLIC_FOR_ALL } from '../../components/Feeds/Utils/FeedsConstants'
import { TASK_EXECUTION_MODE_WORKFLOW } from '../../utils/taskExecutionMode'

const PROJECT_ID = 'proj-1'
const UID = 'user-1'

const user = {
    uid: UID,
    displayName: 'Test User',
    email: 't@e.st',
    photoURL: '',
    photoURL300: '',
    defaultProjectId: PROJECT_ID,
    activeProjects: [PROJECT_ID],
    inactiveProjects: [],
    // SharedHelper.isMember reads this; without it the row renders read-only.
    projectIds: [PROJECT_ID],
    isAnonymous: false,
}

store.dispatch({ type: 'Init anonymous sesion', loggedUser: user, currentUser: user })
store.dispatch({
    type: 'Set project initial data',
    project: { id: PROJECT_ID, name: 'Proj', color: '#ffffff', isShared: false, parentTemplateId: null },
    users: [user],
    workstreams: [],
    contacts: [],
    assistants: [],
})

const NOW = Date.now()

// Mirrors TasksHelper.getNewDefaultTask (that factory itself cannot be called
// here: it asks Firestore for a sort index).
const makeTask = (id, name) => ({
    id,
    done: false,
    inDone: false,
    name,
    extendedName: name,
    description: '',
    userId: UID,
    userIds: [UID],
    currentReviewerId: UID,
    observersIds: [],
    dueDateByObserversIds: {},
    estimationsByObserverIds: {},
    stepHistory: [OPEN_STEP],
    hasStar: '#FFFFFF',
    priority: TASK_PRIORITY_NONE,
    created: NOW,
    creatorId: UID,
    dueDate: NOW,
    completed: null,
    isPrivate: false,
    isPublicFor: [FEED_PUBLIC_FOR_ALL],
    parentId: null,
    isSubtask: false,
    subtaskIds: [],
    subtaskNames: [],
    recurrence: RECURRENCE_NEVER,
    recurrenceOriginalDueDate: null,
    recurrenceBaseDateOverride: null,
    lastEditorId: UID,
    lastEditionDate: NOW,
    linkBack: '',
    estimations: { [OPEN_STEP]: ESTIMATION_0_MIN },
    comments: [],
    commentsData: null,
    genericData: null,
    sortIndex: `harness-sort-${id}`,
    linkedParentNotesIds: [],
    linkedParentTasksIds: [],
    linkedParentContactsIds: [],
    linkedParentProjectsIds: [],
    linkedParentGoalsIds: [],
    linkedParentSkillsIds: [],
    linkedParentAssistantIds: [],
    parentDone: false,
    suggestedBy: null,
    parentGoalId: null,
    parentGoalIsPublicFor: null,
    goalSuggestion: null,
    noteId: null,
    containerNotesIds: [],
    calendarData: null,
    gmailData: null,
    timesPostponed: 0,
    timesFollowed: 0,
    timesDoneInExpectedDay: 0,
    timesDone: 0,
    isPremium: false,
    lockKey: '',
    assigneeType: TASK_ASSIGNEE_USER_TYPE,
    executionMode: TASK_EXECUTION_MODE_WORKFLOW,
    assistantId: '',
    autoEstimation: null,
    completedTime: null,
    autoFollowUpManaged: false,
    autoFollowUpType: null,
    autoFollowUpContactId: null,
    autoFollowUpStatusId: null,
})

// Two rows: the swiped one, and a neighbour. The neighbour matters — the reported
// symptom is about "the task list", so the test has to be able to tell "this one
// row is wedged" apart from "every row is wedged".
const TASKS = [makeTask('task-1', 'Swiped task alpha'), makeTask('task-2', 'Neighbour task bravo')]

function TaskLine({ task }) {
    const dismissibleRef = React.useRef(null)
    const taskItemRef = React.useRef({ onCheckboxPress: () => {} })
    const [, setInEditMode] = React.useState(false)

    return (
        <View nativeID={`line-${task.id}`}>
            <TaskItem
                projectId={PROJECT_ID}
                task={task}
                dismissibleRef={dismissibleRef}
                taskItemRef={taskItemRef}
                subtaskList={[]}
                showSubTaskList={false}
                toggleSubTaskList={() => {}}
                setInEditMode={setInEditMode}
                setShowSubTaskIndicator={() => {}}
                checked={false}
            />
        </View>
    )
}

function Harness() {
    return (
        <View style={{ flex: 1 }}>
            {/* Exactly how RootView composes it: the global modal container is a
                sibling of the content, mounted once for the whole app. */}
            <GlobalModalsContainerRootView />
            <View nativeID="empty-space" style={{ height: 90, backgroundColor: '#eef1f6' }} />
            <CustomScrollView nativeID="main-scroller">
                <View>
                    {TASKS.map(task => (
                        <TaskLine key={task.id} task={task} />
                    ))}
                    <View style={{ height: 400, backgroundColor: '#ffffff' }} nativeID="filler" />
                </View>
            </CustomScrollView>
        </View>
    )
}

const container = document.getElementById('root')
initFirebase(() => {})
    .catch(() => {})
    .then(() => {
        createRoot(container).render(
            <Provider store={store}>
                <Harness />
            </Provider>
        )
        window.__ready = true
    })

const rect = element => {
    if (!element) return null
    const { x, y, width, height } = element.getBoundingClientRect()
    return { x, y, width, height, top: y, bottom: y + height, left: x, right: x + width }
}

window.__rectOfId = id => rect(document.getElementById(id))

// The redux facts that decide whether a task row can be opened at all:
//  * `showSwipeDueDatePopup.visible` gates `TaskItem.toggleModal` outright
//  * `showFloatPopup` gates `DismissibleItem.toggleModal`
window.__state = () => {
    const state = store.getState()
    return {
        swipePopupVisible: state.showSwipeDueDatePopup.visible,
        swipePopupHasData: !!state.showSwipeDueDatePopup.data,
        floatPopup: state.showFloatPopup,
        activeEditMode: state.activeEditMode,
        dismissibleActive: state.dismissibleActive,
    }
}

// What is actually on screen: the postpone popup is a react-tiny-popover portal.
window.__popoverCount = () => document.querySelectorAll('.react-tiny-popover-container').length

window.__popoverRects = () =>
    [...document.querySelectorAll('.react-tiny-popover-container')].map(node => {
        const box = node.getBoundingClientRect()
        return { top: box.top, left: box.left, width: box.width, height: box.height, text: node.innerText.slice(0, 60) }
    })

// Edit mode = the row was replaced by `EditTask`, i.e. a Quill editor exists.
window.__editorCount = () => document.querySelectorAll('.ql-editor').length

// Viewport point of one word of a row's title — where the real mouse click goes.
// `SocialText` renders one span per word, and react-native-web word spans can
// report an empty rect, so fall back to the nearest laid-out ancestor.
window.__pressPoint = (anchorId, word) => {
    const anchor = document.getElementById(anchorId)
    if (!anchor) return null
    const target = [...anchor.querySelectorAll('span, div')].filter(node => node.textContent.trim() === word).pop()
    if (!target) return null
    let box = target
    while (box && box.getBoundingClientRect().height === 0) box = box.parentElement
    if (!box) return null
    const { left, top, width, height } = box.getBoundingClientRect()
    return { x: left + Math.min(width / 2, 120), y: top + height / 2 }
}

// The row body — what the swipe gesture is aimed at.
window.__rowPoint = taskId => {
    const body = document.getElementById(`line-${taskId}`)
    if (!body) return null
    const box = body.getBoundingClientRect()
    return { x: box.left + box.width * 0.6, y: box.top + box.height / 2, box: rect(body) }
}

// Hit-test diagnostics: what the browser thinks is under a point, and the
// `pointer-events` chain above it. Tells "the row is covered / inert" apart from
// "the press arrives and the component refuses to act on it".
window.__hitTest = (x, y) => {
    const element = document.elementFromPoint(x, y)
    if (!element) return null
    const chain = []
    let node = element
    while (node && node !== document.body) {
        chain.push({
            tag: node.tagName,
            id: node.id || null,
            pointerEvents: window.getComputedStyle(node).pointerEvents,
            text: (node.textContent || '').trim().slice(0, 24),
        })
        node = node.parentElement
    }
    return chain
}

// Whether the pan gesture is reaching `Swipeable` at all: the row's translated
// wrapper is the child of the TapGestureHandler, and it carries the transform.
window.__rowTranslate = taskId => {
    const line = document.getElementById(`line-${taskId}`)
    if (!line) return null
    const translated = [...line.querySelectorAll('*')]
        .map(node => window.getComputedStyle(node).transform)
        .filter(value => value && value !== 'none')
    return translated
}
