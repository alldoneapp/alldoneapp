import { createStore } from 'redux'

const task = {
    id: 'task-1',
    name: 'Get Karla an estimate an usage uptake for 2027 and then discuss next steps',
    extendedName: 'Get Karla an estimate an usage uptake for 2027 and then discuss next steps',
    dueDate: new Date('2026-10-06T10:00:00Z').getTime(),
    userId: 'owner',
    userIds: ['owner'],
    estimations: { open: 0 },
    recurrence: 'never',
}
export default createStore(
    (
        state = {
            loggedUser: { uid: 'owner' },
            activeNoteId: 'note-1',
            activeNoteIsReadOnly: false,
            notesInnerTasks: { 'note-1': { 'task-1': task } },
            quillTextInputProjectIdsByEditorId: { 'note-1': 'project-1' },
            quillEditorProjectId: 'project-1',
            smallScreenNavigation: window.innerWidth < 600,
            isMiddleScreen: false,
            virtualQuillLoaded: false,
        }
    ) => state
)
