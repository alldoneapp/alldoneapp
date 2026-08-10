/**
 * AT-2220 browser regression harness — entry point.
 *
 * "When I click into a 'new task line' or click into an existing task the app
 *  should not 'jump around' in scrolling .. currently the input fields almost go
 *  out of the screen (too much below)"
 *
 * The defect is a scroll position, so it cannot be reproduced in Jest: jsdom
 * implements no layout (every box is 0x0, every scroller has scrollHeight 0) and
 * Quill cannot even be constructed there (see browser-tests/README.md). This
 * harness therefore renders the REAL scroll container the app uses for the task
 * list (`CustomScrollView`, exactly as `MainViewsContainer` mounts it) with a
 * REAL `NewTaskSection` (the add-task line) and a REAL `TaskItem` (an existing
 * task) inside it, and `run.js` asserts on `scrollTop` /
 * `getBoundingClientRect()` in real Chromium — i.e. on what the user sees.
 *
 * Nothing on the path under test is a double: the click goes through the real
 * `DismissibleItem`, the real `EditTask`, the real `TaskInput` and the real
 * `CustomTextInput3` / Quill 2 editor, which is where the scroll actually
 * happens.
 */
import 'setimmediate'
import React from 'react'
import { View } from 'react-native'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'

import store from '../../redux/store'
import { initFirebase } from '../../utils/backends/firestore'
import CustomScrollView from '../../components/UIControls/CustomScrollView'
import { quillTextInputRefs } from '../../components/Feeds/CommentsTextInput/CustomTextInput3'
import NewTaskSection from '../../components/TaskListView/OpenTasksView/NewTaskSection'
import TaskItem from '../../components/TaskListView/TaskItem'
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
    // SharedHelper.isMember reads this; without it every editor renders
    // read-only (`ql-disabled`) and never takes focus.
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

const params = new URLSearchParams(window.location.search)
// How many filler rows go above the interactive lines. The point of the filler
// is that the list is genuinely longer than the viewport, so the scroller has
// somewhere to jump to.
const ROWS_ABOVE = Number(params.get('above') || 30)
const ROWS_BELOW = Number(params.get('below') || 30)
const ROW_HEIGHT = 44
// A title long enough to wrap over several lines, which is where the editor gets
// tall and the caret (put at the end of the text) sits far below the row's top.
const LONG_TITLE =
    'An existing task that is already on the list and whose title is long enough that it wraps onto several lines ' +
    'in the editor, which is exactly when the caret ends up far below the top of the row it replaced'

// Mirrors TasksHelper.getNewDefaultTask (that factory itself cannot be called
// here: it asks Firestore for a sort index).
const NOW = Date.now()
const existingTask = {
    id: 'task-1',
    done: false,
    inDone: false,
    name: params.get('long') === '1' ? LONG_TITLE : 'An existing task that is already on the list',
    extendedName: params.get('long') === '1' ? LONG_TITLE : 'An existing task that is already on the list',
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
    sortIndex: 'harness-sort-index',
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
}

const Filler = ({ count, prefix }) =>
    Array.from({ length: count }, (unused, index) => (
        <View
            key={`${prefix}-${index}`}
            nativeID={`${prefix}-${index}`}
            style={{ height: ROW_HEIGHT, justifyContent: 'center', paddingLeft: 16, backgroundColor: '#ffffff' }}
        >
            <span style={{ color: '#4e5d78', fontSize: 14 }}>{`${prefix} row ${index}`}</span>
        </View>
    ))

function ExistingTaskLine() {
    const dismissibleRef = React.useRef(null)
    const taskItemRef = React.useRef({ onCheckboxPress: () => {} })
    const [, setInEditMode] = React.useState(false)

    return (
        <View nativeID="existing-task-line">
            <TaskItem
                projectId={PROJECT_ID}
                task={existingTask}
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
            <CustomScrollView nativeID="main-scroller">
                <View>
                    <Filler count={ROWS_ABOVE} prefix="above" />
                    <View nativeID="new-task-anchor">
                        <NewTaskSection
                            projectId={PROJECT_ID}
                            instanceKey="harness"
                            dateIndex={0}
                            hideParentGoalButton={true}
                            expandTasksList={() => {}}
                        />
                    </View>
                    <ExistingTaskLine />
                    <Filler count={ROWS_BELOW} prefix="below" />
                </View>
            </CustomScrollView>
        </View>
    )
}

// The list rows attach real Firestore listeners (backlink counts, goal watchers).
// A real client with the placeholder config is enough: the requests never resolve,
// which is exactly the "nothing has loaded yet" state, and every component on the
// path under test stays real instead of being stubbed out.
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

// The scroller `CustomScrollView` renders is the react-native-web ScrollView
// div inside the nativeID'd wrapper — the element that actually owns scrollTop.
const findScroller = () => {
    const wrapper = document.getElementById('main-scroller')
    if (!wrapper) return null
    const candidates = [wrapper, ...wrapper.querySelectorAll('*')]
    return candidates.find(node => node.scrollHeight - node.clientHeight > 1 && node.clientHeight > 0) || null
}

window.__scrollState = () => {
    const scroller = findScroller()
    return scroller
        ? {
              scrollTop: scroller.scrollTop,
              scrollHeight: scroller.scrollHeight,
              clientHeight: scroller.clientHeight,
              windowScrollY: window.scrollY,
              bodyScrollTop: document.body.scrollTop,
          }
        : null
}

window.__setScrollTop = value => {
    const scroller = findScroller()
    if (scroller) scroller.scrollTop = value
}

window.__rectOf = selector => rect(document.querySelector(selector))

window.__rectOfId = id => rect(document.getElementById(id))

// The visible task/add-task line: before the click it is the placeholder row,
// after the click it is the Quill editor the user types into.
window.__editorRect = () => {
    const editor = document.querySelector('.ql-editor')
    return editor ? rect(editor) : null
}

window.__editorCount = () => document.querySelectorAll('.ql-editor').length

// The editor card the user has to work with: the input AND the action bar with
// its buttons — i.e. everything the row turned into, without the layout margin
// the surrounding list puts around it. Found by walking up from the editor to
// the outermost element still inside the line's wrapper, so it needs no testID
// in app code and works against the unfixed build too.
window.__editorCardRect = anchorId => {
    const anchor = document.getElementById(anchorId)
    const editor = anchor && anchor.querySelector('.ql-editor')
    if (!editor) return null
    const anchorRect = anchor.getBoundingClientRect()

    // Only boxes that actually PAINT count. The line's outermost wrappers are
    // transparent and report 16px more than the editor because the editor card
    // carries a bottom margin — empty spacing, not something the user needs to
    // see. Measuring paint also drops the off-screen swipe layers (translated
    // far to the left). Deliberately derived from the DOM rather than a testID
    // the fix adds, so the same measurement runs against the unfixed build.
    const paints = node => {
        const style = window.getComputedStyle(node)
        if (style.visibility === 'hidden' || style.display === 'none') return false
        const background = style.backgroundColor
        if (background && background !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(background))
            return true
        if (['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(style[`border${side}Width`]) > 0)) return true
        return [...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim().length > 0)
    }

    let top = Infinity
    let bottom = -Infinity
    for (const node of anchor.querySelectorAll('*')) {
        const box = node.getBoundingClientRect()
        if (box.height <= 0 || box.width <= 0) continue
        if (box.left < anchorRect.left - 1 || box.right > anchorRect.right + 1) continue
        if (!paints(node)) continue
        top = Math.min(top, box.top)
        bottom = Math.max(bottom, box.bottom)
    }
    if (top === Infinity) return rect(anchor)
    return { top, bottom, height: bottom - top, x: anchorRect.left, y: top, width: anchorRect.width }
}

// Re-focus the open editor through the app's own path.
//
// `EditTask` does exactly this whenever a popup it opened closes
// (`onDismissPopup`), after an assignee is picked, and after a mention is
// inserted (`keepFocus`) — all of them `inputTask.current.focus()`, i.e. the
// registered editor's `focus()`. Under stock Quill 2 each of those walks every
// scrollable ancestor and drags the task list back to the caret, long after the
// line was opened; that is the "jumping around" the user keeps hitting while
// working in an editor, not just when opening one.
window.__refocusEditor = () => {
    const entry = Object.values(quillTextInputRefs).find(candidate => {
        const editor = candidate && candidate.getEditor && candidate.getEditor()
        return editor && editor.root && document.body.contains(editor.root)
    })
    if (!entry) return 'no editor'
    entry.getEditor().focus()
    return 'focused'
}

// Viewport point of a single word of the line's title — where the real mouse
// click goes. `SocialText` renders one span per word and react-native-web's word
// spans can report an empty rect, so fall back to the nearest laid-out ancestor.
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
