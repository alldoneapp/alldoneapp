/**
 * @jest-environment jsdom
 *
 * AT-2454, end to end: "a task in a note sometimes disappears when you edit the note nearby the
 * task… when you reload the note the task is being shown again". The reported shape is an EMPTY
 * GAP roughly where the row was, on desktop web and the installed desktop PWA, and only a reload
 * brings it back.
 *
 * This suite drives the REAL `TaskTagFormat` blot inside a REAL quill 2 editor with the REAL
 * `TaskTagWrapper` and `TaskTag` underneath, and asserts the one contract that makes the reported
 * symptom impossible: **an embed in a note always renders something a user can see**.
 *
 * Why end to end and not a unit test of `TaskTag`: the gap is produced by a chain that no single
 * component owns — quill creates the blot node, `blots/embed` relocates whatever React rendered
 * into it, redux may or may not have the task yet, and the row measures its own geometry. Each
 * link is individually defensible and the hole only exists where they meet.
 */
import React from 'react'
import Quill from 'quill'

let mockState
const mockGetTaskData = jest.fn()

jest.mock('react-redux', () => ({
    __esModule: true,
    Provider: ({ children }) => children,
    connect: () => Component => Component,
    useDispatch: () => () => {},
    useStore: () => ({ getState: () => mockState, subscribe: () => () => {}, dispatch: () => {} }),
    shallowEqual: (a, b) => a === b,
    useSelector: selector => selector(mockState),
}))
jest.mock('../../../../../redux/store', () => ({
    __esModule: true,
    // Built inside the factory: babel transpiles const to var, so a module-scope binding is still
    // undefined when jest hoists this mock above it.
    default: { getState: () => mockState, subscribe: () => () => {}, dispatch: () => {} },
}))
jest.mock(
    '../../../../UIComponents/ModalShell/AppPopover',
    () =>
        ({ children }) =>
            children
)
jest.mock('../../../../UIComponents/FloatModals/ManageTaskModal/ManageTaskModal', () => () => null)
jest.mock('../../../../UIComponents/FloatModals/ManageTaskModal/RemovedTaskModal', () => () => null)
jest.mock('../../../../NotesView/NotesDV/EditorView/NotesEditorView', () => ({ exportRef: {} }))
jest.mock('../../CustomTextInput3', () => ({ quillTextInputRefs: {}, quillTextInputProjectIds: {} }))
jest.mock('../../textInputHelper', () => ({ getQuillEditorRef: () => ({ editorRef: null }) }))
jest.mock('../../../../ModalsManager/modalsManager', () => ({
    exitsOpenModals: () => false,
    MANAGE_TASK_MODAL_ID: 'manage-task',
    storeModal: jest.fn(),
}))
jest.mock('../../../../../utils/SharedHelper', () => ({ accessGranted: () => true }))
jest.mock('../../../../../utils/HelperFunctions', () => ({ popoverToCenter: jest.fn(), getPopoverWidth: () => 600 }))
jest.mock('../../../../../utils/backends/Tasks/tasksFirestore', () => ({
    setTaskDueDate: jest.fn(),
    setTaskDescription: jest.fn(),
}))
jest.mock('../../../../../utils/BackendBridge', () => ({
    __esModule: true,
    default: {
        getTaskData: (...args) => mockGetTaskData(...args),
        watchSubtasks: jest.fn(),
        unwatch: jest.fn(),
    },
}))
jest.mock('../../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { checkIfLoggedUserIsNormalUserInGuide: () => false },
}))
jest.mock('../../../../AdminPanel/Assistants/assistantsHelper', () => ({ getAssistant: () => null }))
jest.mock('../../../../Workstreams/WorkstreamHelper', () => ({ WORKSTREAM_ID_PREFIX: 'workstream_' }))
jest.mock('../../../../../utils/EstimationHelper', () => ({ getEstimationRealValue: () => 0 }))
jest.mock('../../../../TaskListView/Utils/TasksHelper', () => ({
    __esModule: true,
    default: { getUserInProject: () => ({ photoURL: '' }), getContactInProject: () => null },
    OPEN_STEP: 'open',
    RECURRENCE_NEVER: 'never',
    TASK_ASSIGNEE_ASSISTANT_TYPE: 'assistant',
}))

import TaskTagFormat from './taskTagFormat'

Quill.register(TaskTagFormat, true)

const NOTE_ID = 'note-1'
const PROJECT_ID = 'project-1'

const openTask = {
    id: 'task-1',
    extendedName: 'Ship the release notes',
    userId: 'user-1',
    userIds: ['user-1'],
    estimations: { open: 0 },
    recurrence: 'never',
    done: false,
    commentsData: null,
}

const baseState = (overrides = {}) => ({
    activeNoteId: NOTE_ID,
    activeNoteIsReadOnly: false,
    loggedUser: { uid: 'user-1' },
    notesInnerTasks: { [NOTE_ID]: { 'task-1': openTask } },
    quillEditorProjectId: PROJECT_ID,
    quillTextInputProjectIdsByEditorId: { [NOTE_ID]: PROJECT_ID },
    smallScreenNavigation: false,
    isMiddleScreen: false,
    virtualQuillLoaded: false,
    ...overrides,
})

const buildNote = () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const quill = new Quill(host)
    quill.setContents([
        { insert: 'Some prose before the task ' },
        {
            insert: {
                taskTagFormat: {
                    id: 'tag-1',
                    taskId: 'task-1',
                    editorId: NOTE_ID,
                    objectUrl: 'https://alldone.app/task',
                },
            },
        },
        { insert: ' and prose after it\n' },
    ])
    return { quill, embed: quill.root.querySelector('span.ql-taskTagFormat') }
}

// What the user actually sees: any rendered text inside the embed, ignoring quill's zero-width
// cursor guards.
const visibleText = embed => embed.textContent.replace(/﻿/g, '').trim()

describe('a task embed in a note always renders something visible (AT-2454)', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        mockGetTaskData.mockReset()
        mockState = baseState()
        // jsdom lays nothing out, so every measurement answers 0 — the same "unusable
        // measurement" the row has to survive in production.
        Element.prototype.getBoundingClientRect = function () {
            return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }
        }
    })

    afterEach(() => {
        jest.useRealTimers()
        document.body.innerHTML = ''
    })

    it('shows the task title with the task already in redux', () => {
        const { embed } = buildNote()
        expect(visibleText(embed)).toContain('Ship the release notes')
    })

    it('shows a loading row rather than an empty gap while the task has not arrived', () => {
        // The note's aggregate query resolves after the editor renders, so this is the ordinary
        // first frame of every note — and with `editorId !== activeNoteId` it used to render
        // nothing at all.
        mockState = baseState({ notesInnerTasks: {}, activeNoteId: 'a-different-note' })
        const { embed } = buildNote()

        expect(visibleText(embed)).not.toBe('')
        expect(visibleText(embed)).toContain('Loading')
    })

    it('never renders an empty row for a task that has no title', () => {
        mockState = baseState({
            notesInnerTasks: { [NOTE_ID]: { 'task-1': { ...openTask, extendedName: '' } } },
        })
        const { embed } = buildNote()

        expect(visibleText(embed)).not.toBe('')
    })

    it('keeps drawing the row when the note is edited around it', () => {
        const { quill, embed } = buildNote()
        expect(visibleText(embed)).toContain('Ship the release notes')

        // Type before the row (pushing it right), delete before it, and format around it — the
        // three things "editing the note nearby the task" actually does.
        for (let i = 0; i < 20; i++) quill.insertText(5, 'x', 'user')
        quill.deleteText(0, 3, 'user')
        quill.formatText(0, 10, 'bold', true, 'user')
        quill.update()

        const stillThere = quill.root.querySelector('span.ql-taskTagFormat')
        expect(stillThere).toBe(embed)
        expect(visibleText(stillThere)).toContain('Ship the release notes')
    })

    it('keeps drawing the row after quill rebuilds every blot', () => {
        // `replaceQuillImagesByCustomImagesFormat` and the remove-tag path both call
        // `editor.setContents(...)`, which throws away every embed node and runs `create()` again.
        // The rebuilt row must be readable on its FIRST frame: its name used to live in state
        // written from an effect, so the fresh root rendered an empty 150px box until that effect
        // flushed — and never recovered if it did not.
        const { quill } = buildNote()

        quill.setContents(quill.getContents().ops)

        const rebuilt = quill.root.querySelector('span.ql-taskTagFormat')
        expect(visibleText(rebuilt)).toContain('Ship the release notes')
    })

    it('renders the row inside quill’s content node, not after the cursor guard', () => {
        const { embed } = buildNote()
        const contentNode = embed.querySelector('span[contenteditable="false"]')

        expect(contentNode).not.toBeNull()
        expect(contentNode.textContent).toContain('Ship the release notes')
        // Nothing escaped past the right guard.
        expect(embed.lastChild.nodeType).toBe(3)
        expect(embed.lastChild.data).toBe('﻿')
    })
})
