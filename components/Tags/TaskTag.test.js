/**
 * @jest-environment jsdom
 *
 * AT-2454 — "a task in a note sometimes disappears when you edit the note nearby the task…
 * when you reload the note the task is being shown again".
 *
 * The row measures how much horizontal room it has (`window width - its own left - gutters`)
 * and used to clamp its icon+title to `Math.max(0, maxWidth - tagsWidth)` with
 * `overflow: hidden`. Every way that measurement goes wrong therefore ended in a row with a
 * literal `max-width: 0` — the task's icon and title clipped away to nothing while the blot and
 * the Yjs document were untouched, which is exactly why a reload brought it back.
 *
 * These tests pin the three states a row may never render as "nothing": an unusable
 * measurement, a task that is still loading, and a task with no title.
 */
import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import TaskTag, { MIN_TASK_TAG_LABEL_WIDTH, UNNAMED_TASK_LABEL } from './TaskTag'
import LoadingTag from './LoadingTag'

const mockWatchSubtasks = jest.fn()
const mockUnwatch = jest.fn()
let mockBoundingRect = { left: 0 }
let mockWindowSize = [1600, 900]

jest.mock('react-redux', () => ({ useSelector: jest.fn() }))
jest.mock('../../utils/useWindowSize', () => ({ __esModule: true, default: () => mockWindowSize }))
jest.mock('react-dom', () => ({
    __esModule: true,
    default: { findDOMNode: node => node },
    findDOMNode: node => node,
}))
jest.mock('../../utils/BackendBridge', () => ({
    __esModule: true,
    default: {
        watchSubtasks: (...args) => mockWatchSubtasks(...args),
        unwatch: (...args) => mockUnwatch(...args),
    },
}))
jest.mock('../../utils/backends/Tasks/tasksFirestore', () => ({ setTaskDescription: jest.fn() }))
jest.mock('../styles/global', () => {
    const actual = jest.requireActual('../styles/global')
    return { __esModule: true, ...actual, windowTagStyle: () => ({}) }
})
jest.mock('../Icon', () => 'Icon')
jest.mock('./TaskEstimation', () => 'TaskEstimation')
jest.mock('./DescriptionTag', () => 'DescriptionTag')
jest.mock('./TaskRecurrence', () => 'TaskRecurrence')
jest.mock('./PrivacyTag', () => 'PrivacyTag')
jest.mock('./TaskSubTasks', () => 'TaskSubTasks')
jest.mock('./TaskSummation', () => 'TaskSummation')
jest.mock('./TaskCommentsWrapper', () => 'TaskCommentsWrapper')
jest.mock('../UIControls/DateTagButton', () => 'DateTagButton')
jest.mock('../../assets/svg/SVGGenericUser', () => 'SVGGenericUser')
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { checkIfLoggedUserIsNormalUserInGuide: () => false },
}))
jest.mock('../AdminPanel/Assistants/assistantsHelper', () => ({ getAssistant: () => null }))
jest.mock('../Workstreams/WorkstreamHelper', () => ({ WORKSTREAM_ID_PREFIX: 'workstream_' }))
jest.mock('../../utils/EstimationHelper', () => ({ getEstimationRealValue: () => 0 }))
jest.mock('../../utils/LinkingHelper', () => ({ handleNestedLinks: text => text }))
jest.mock('../TaskListView/Utils/TasksHelper', () => ({
    __esModule: true,
    default: { getUserInProject: () => ({ photoURL: '' }), getContactInProject: () => null },
    OPEN_STEP: 'open',
    RECURRENCE_NEVER: 'never',
    TASK_ASSIGNEE_ASSISTANT_TYPE: 'assistant',
}))

const task = overrides => ({
    id: 'task-1',
    extendedName: 'Ship the release notes',
    userId: 'user-1',
    userIds: ['user-1'],
    estimations: { open: 0 },
    recurrence: 'never',
    done: false,
    ...overrides,
})

const setState = (overrides = {}) => {
    useSelector.mockImplementation(selector =>
        selector({
            virtualQuillLoaded: false,
            loggedUser: { uid: 'user-1' },
            smallScreenNavigation: false,
            isMiddleScreen: false,
            ...overrides,
        })
    )
}

const nodeMock = () => ({ getBoundingClientRect: () => mockBoundingRect })

const render = (props = {}) => {
    let tree
    act(() => {
        tree = renderer.create(
            <TaskTag
                editorId="note-1"
                projectId="project-1"
                taskId="task-1"
                task={task()}
                isLoading={false}
                isDeleted={false}
                disabled={false}
                onPress={jest.fn()}
                saveDueDateCallback={jest.fn()}
                {...props}
            />,
            { createNodeMock: nodeMock }
        )
    })
    return tree
}

const flatten = style => (Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flatten)) : style || {})

const labelButton = tree => tree.root.findAllByType(TouchableOpacity)[0]
const titleText = tree =>
    tree.root
        .findAllByType(Text)
        .map(node => node.props.children)
        .flat()

beforeEach(() => {
    jest.clearAllMocks()
    mockBoundingRect = { left: 0 }
    mockWindowSize = [1600, 900]
    setState()
})

describe('TaskTag never renders itself away (AT-2454)', () => {
    it('keeps the icon and title readable when the row sits far to the right', () => {
        // The row is pushed right by text typed before it: window 1600, left 1560 => the old
        // formula yields a negative width, which used to clamp the label to max-width: 0.
        mockBoundingRect = { left: 1560 }
        const tree = render()

        const style = flatten(labelButton(tree).props.style)
        expect(style.maxWidth === 0).toBe(false)
        expect(titleText(tree)).toContain('Ship the release notes')
    })

    it('never clamps the label below the readable minimum', () => {
        mockBoundingRect = { left: 900 } // ~578px of room
        const tree = render()

        act(() => {
            // The chip row (comments, due date, description, avatar…) claims more room than the
            // measurement left over.
            tree.root.findAllByType(View).forEach(node => {
                if (node.props.onLayout && node.props.onLayout !== undefined) {
                    node.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 4000, height: 24 } } })
                }
            })
        })

        const style = flatten(labelButton(tree).props.style)
        expect(style.maxWidth).toBeGreaterThanOrEqual(MIN_TASK_TAG_LABEL_WIDTH)
    })

    it('leaves the row unconstrained while the measurement is unusable', () => {
        mockBoundingRect = { left: 5000 } // wider than the window: nothing usable to measure
        const tree = render()

        const container = tree.root.findAllByType(View)[0]
        expect(flatten(container.props.style).maxWidth).not.toBe(0)
        expect(flatten(labelButton(tree).props.style).maxWidth).toBeUndefined()
    })

    it('shows a loading placeholder instead of a zero-size hole', () => {
        // `editorId !== activeNoteId` used to render literally nothing here, so a row waiting
        // for its task was an invisible embed rather than a visible placeholder.
        const tree = render({ isLoading: true, task: null })

        expect(tree.root.findAllByType(LoadingTag)).toHaveLength(1)
    })

    it('names a task that has no title instead of rendering nothing', () => {
        const tree = render({ task: task({ extendedName: '' }) })

        expect(tree.root.findAllByType(TouchableOpacity).length).toBeGreaterThan(0)
        expect(titleText(tree)).toContain(UNNAMED_TASK_LABEL)
    })

    it('renders a removed task rather than an empty row', () => {
        const tree = render({ task: null, isDeleted: true, isLoading: false })

        expect(titleText(tree)).toContain('Task removed')
    })

    it('re-measures on a window resize instead of drifting negative', () => {
        // The old code subtracted `(previousWidth - width) + 50` from a stale `maxWidth` on
        // every narrowing step and never gave the 50 back, so a drag-resize (dozens of resize
        // events) drove the row's width below zero and clipped the label away.
        mockBoundingRect = { left: 100 }
        const tree = render()
        const initial = flatten(labelButton(tree).props.style).maxWidth

        for (let step = 0; step < 10; step++) {
            mockWindowSize = [1600 - (step + 1) * 10, 900]
            act(() => {
                tree.update(
                    <TaskTag
                        editorId="note-1"
                        projectId="project-1"
                        taskId="task-1"
                        task={task()}
                        isLoading={false}
                        isDeleted={false}
                        disabled={false}
                        onPress={jest.fn()}
                        saveDueDateCallback={jest.fn()}
                    />
                )
            })
        }

        const afterResizes = flatten(labelButton(tree).props.style).maxWidth
        expect(afterResizes).toBeGreaterThanOrEqual(MIN_TASK_TAG_LABEL_WIDTH)
        // 10 narrowing steps of 10px may only cost ~100px, never the extra 50 per step.
        expect(initial - afterResizes).toBeLessThanOrEqual(120)
    })

    it('always hands react-native-web an onLayout function so the row keeps being observed', () => {
        // useElementLayout decides ONCE on mount whether to observe the node; a null handler at
        // that moment meant the row was never measured again for the rest of its life.
        const loading = render({ isLoading: true, task: null })
        expect(typeof loading.root.findAllByType(View)[0].props.onLayout).toBe('function')

        const loaded = render()
        expect(typeof loaded.root.findAllByType(View)[0].props.onLayout).toBe('function')
    })

    it('stops watching subtasks when the row goes away', () => {
        const tree = render()
        expect(mockWatchSubtasks).toHaveBeenCalledTimes(1)

        act(() => tree.unmount())
        expect(mockUnwatch).toHaveBeenCalledTimes(1)
    })
})
