import React from 'react'
import renderer, { act } from 'react-test-renderer'

import TaskTagWrapper, { selectTaskForEditor, selectTaskTagProjectId } from './TaskTagWrapper'

let mockState
const mockGetTaskData = jest.fn()

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))
jest.mock(
    '../../../../UIComponents/ModalShell/AppPopover',
    () =>
        ({ children }) =>
            children
)
jest.mock('../../../../Tags/TaskTag', () => props => {
    const React = require('react')
    return React.createElement('TaskTag', props)
})
jest.mock('../../../../NotesView/NotesDV/EditorView/NotesEditorView', () => ({ exportRef: {} }))
jest.mock('../../CustomTextInput3', () => ({ quillTextInputRefs: {} }))
jest.mock('../../textInputHelper', () => ({ getQuillEditorRef: () => ({ editorRef: null }) }))
jest.mock('../../../../UIComponents/FloatModals/ManageTaskModal/ManageTaskModal', () => () => null)
jest.mock('../../../../UIComponents/FloatModals/ManageTaskModal/RemovedTaskModal', () => () => null)
jest.mock('../../../../ModalsManager/modalsManager', () => ({
    exitsOpenModals: () => false,
    MANAGE_TASK_MODAL_ID: 'manage-task',
    storeModal: jest.fn(),
}))
jest.mock('../../../../../utils/SharedHelper', () => ({ accessGranted: () => true }))
jest.mock('../../../../../utils/HelperFunctions', () => ({ popoverToCenter: jest.fn() }))
jest.mock('../../../../../utils/BackendBridge', () => ({ getTaskData: (...args) => mockGetTaskData(...args) }))
jest.mock('../../../../../utils/backends/Tasks/tasksFirestore', () => ({ setTaskDueDate: jest.fn() }))

describe('TaskTagWrapper editor-scoped task lookup', () => {
    const doneTask = { id: 'task-1', done: true, extendedName: 'Finished task' }

    it('keeps rendering a task from its note when the global active note id is cleared', () => {
        const state = {
            activeNoteId: '',
            notesInnerTasks: {
                'note-1': { 'task-1': doneTask },
            },
        }

        expect(selectTaskForEditor(state, 'note-1', 'task-1')).toBe(doneTask)
    })

    it('uses the active note as a fallback for an older copied embed', () => {
        const state = {
            activeNoteId: 'note-2',
            notesInnerTasks: {
                'note-2': { 'task-1': doneTask },
            },
        }

        expect(selectTaskForEditor(state, 'old-note-id', 'task-1')).toBe(doneTask)
    })

    it('uses the project belonging to the note editor instead of another active Quill editor', () => {
        const state = {
            quillEditorProjectId: 'other-project',
            quillTextInputProjectIdsByEditorId: {
                'note-1': 'note-project',
            },
        }

        expect(selectTaskTagProjectId(state, 'note-1')).toBe('note-project')
    })
})

describe('TaskTagWrapper missing-task recovery', () => {
    const openTask = { id: 'task-1', done: false, extendedName: 'Finish this' }
    const doneTask = { ...openTask, done: true, completed: 123 }

    beforeEach(() => {
        jest.useFakeTimers()
        mockGetTaskData.mockReset()
        mockState = {
            activeNoteId: 'note-1',
            activeNoteIsReadOnly: false,
            loggedUser: { uid: 'user-1' },
            notesInnerTasks: { 'note-1': { 'task-1': openTask } },
            quillEditorProjectId: 'project-1',
            quillTextInputProjectIdsByEditorId: { 'note-1': 'project-1' },
            smallScreenNavigation: false,
        }
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('uses the backend loader by default', () => {
        let tree
        act(() => {
            tree = renderer.create(<TaskTagWrapper editorId="note-1" taskId="task-1" />)
        })

        expect(tree.root.findByType('TaskTag').props.task).toBe(openTask)
    })

    it('keeps the last row visible and restores the completed task with a direct read', async () => {
        let tree
        act(() => {
            tree = renderer.create(<TaskTagWrapper editorId="note-1" taskId="task-1" loadTask={mockGetTaskData} />)
        })
        expect(tree.root.findByType('TaskTag').props.task).toBe(openTask)
        expect(jest.getTimerCount()).toBe(0)

        mockState = { ...mockState, notesInnerTasks: { 'note-1': {} } }
        expect(selectTaskForEditor(mockState, 'note-1', 'task-1')).toBeNull()
        mockGetTaskData.mockResolvedValue(doneTask)
        act(() => {
            tree.update(
                <TaskTagWrapper editorId="note-1" taskId="task-1" objectUrl="updated" loadTask={mockGetTaskData} />
            )
        })

        expect(tree.root.findByType('TaskTag').props.task).toBe(openTask)
        expect(tree.root.findByType('TaskTag').props.isLoading).toBe(false)
        expect(jest.getTimerCount()).toBe(1)

        await act(async () => {
            jest.runOnlyPendingTimers()
            await Promise.resolve()
        })

        expect(jest.getTimerCount()).toBe(0)
        expect(mockGetTaskData).toHaveBeenCalledWith('project-1', 'task-1')
        expect(tree.root.findByType('TaskTag').props.task).toBe(doneTask)
    })
})
