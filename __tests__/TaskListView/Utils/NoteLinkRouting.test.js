/**
 * @jest-environment jsdom
 */

// AT-2356: clicking a note tag inside a task title routes through the URL system
// (`/projects/{projectId}/notes/{noteId}/editor` -> `processURLNoteDetailsTab`), while
// opening the same note from inside the tag popup navigates to the DV directly. The URL
// path used to resolve the note's owner with `getUserDataByUidOrEmail`, which only knows
// `users/` — so a note created by an assistant (its `userId` is the assistant id) came
// back as "no user" and the route bounced to the followed-notes list instead of the note.

import { seedLoggedUser, seedProjects } from '../../../testUtils/seedStore'
import TasksHelper from '../../../components/TaskListView/Utils/TasksHelper'
import Backend from '../../../utils/BackendBridge'
import URLsNotes, { URL_PROJECT_USER_NOTES_FOLLOWED } from '../../../URLSystem/Notes/URLsNotes'
import store from '../../../redux/store'
import { storeCurrentUser } from '../../../redux/actions'
import { DV_TAB_NOTE_EDITOR } from '../../../utils/TabNavigationConstants'

const PROJECT_ID = 'seeded-project-0'
const NOTE_ID = 'soRpZQOp7LmPqWHFOdcW'
const ASSISTANT_ID = '-Opl-0IPPlv26577k_M2'
const LOGGED_USER_ID = 'lejVqrT6FBcMRRCxnBbBhQwPgSg1'

const note = {
    id: NOTE_ID,
    title: 'Product Launch Checklist',
    // The note was created through the assistant, so its owner is the assistant id.
    userId: ASSISTANT_ID,
    parentObject: null,
}

describe('AT-2356 - opening a note from a note tag URL', () => {
    let navigation
    let replaceSpy

    beforeEach(() => {
        jest.restoreAllMocks()
        navigation = { navigate: jest.fn() }
        replaceSpy = jest.spyOn(URLsNotes, 'replace').mockImplementation(() => {})
        store.dispatch([
            ...seedProjects([{ id: PROJECT_ID }]),
            seedLoggedUser({ uid: LOGGED_USER_ID, projectIds: [PROJECT_ID] }),
            storeCurrentUser({ uid: LOGGED_USER_ID }),
        ])
        jest.spyOn(Backend, 'getNoteMeta').mockResolvedValue({ ...note })
    })

    const expectNoteOpened = () => {
        expect(navigation.navigate).toHaveBeenCalledWith(
            'NotesDetailedView',
            expect.objectContaining({ noteId: NOTE_ID, projectId: PROJECT_ID })
        )
        expect(replaceSpy).not.toHaveBeenCalledWith(
            URL_PROJECT_USER_NOTES_FOLLOWED,
            expect.anything(),
            expect.anything(),
            expect.anything()
        )
    }

    it('opens a note whose owner is an assistant, with the logged user as context', async () => {
        // A note created through the assistant stores the assistant id in `userId`.
        jest.spyOn(Backend, 'getUserOrContactBy').mockResolvedValue({
            uid: ASSISTANT_ID,
            displayName: 'JTL Assistant',
            temperature: 'TEMPERATURE_NORMAL',
        })

        await TasksHelper.processURLNoteDetailsTab(navigation, DV_TAB_NOTE_EDITOR, PROJECT_ID, NOTE_ID)

        expectNoteOpened()
        // An assistant is not a person: the DV keeps the logged user's context, exactly
        // like `processURLTaskDetailsTab` does for assistant-owned tasks.
        expect(store.getState().currentUser.uid).toEqual(LOGGED_USER_ID)
    })

    it('opens a note whose owner cannot be resolved at all', async () => {
        jest.spyOn(Backend, 'getUserOrContactBy').mockResolvedValue(null)

        await TasksHelper.processURLNoteDetailsTab(navigation, DV_TAB_NOTE_EDITOR, PROJECT_ID, NOTE_ID)

        expectNoteOpened()
        expect(store.getState().currentUser.uid).toEqual(LOGGED_USER_ID)
    })

    it('still opens a note owned by a real user with that user as context', async () => {
        const owner = { uid: 'another-real-user', displayName: 'Daniela' }
        Backend.getNoteMeta.mockResolvedValue({ ...note, userId: owner.uid })
        jest.spyOn(Backend, 'getUserOrContactBy').mockResolvedValue(owner)

        await TasksHelper.processURLNoteDetailsTab(navigation, DV_TAB_NOTE_EDITOR, PROJECT_ID, NOTE_ID)

        expectNoteOpened()
        expect(store.getState().currentUser.uid).toEqual(owner.uid)
    })

    it('still falls back to the notes list when the note itself cannot be read', async () => {
        Backend.getNoteMeta.mockResolvedValue(null)
        jest.spyOn(Backend, 'getUserOrContactBy').mockResolvedValue(null)

        await TasksHelper.processURLNoteDetailsTab(navigation, DV_TAB_NOTE_EDITOR, PROJECT_ID, NOTE_ID)

        expect(navigation.navigate).toHaveBeenCalledWith('Root')
        expect(replaceSpy).toHaveBeenCalledWith(
            URL_PROJECT_USER_NOTES_FOLLOWED,
            expect.anything(),
            PROJECT_ID,
            LOGGED_USER_ID
        )
    })

    // Second half of AT-2356: a note ATTACHED to another object (`parentObject`) was only
    // routed when its parent was a task. A note attached to a contact or a goal took the
    // same bail-out as the assistant-owned note above and landed on the notes list, even
    // though the tag popup opens it in the note editor without complaining.
    describe('notes attached to another object', () => {
        beforeEach(() => {
            jest.spyOn(Backend, 'getUserOrContactBy').mockResolvedValue(null)
        })

        it('opens a note attached to a contact in the note editor', async () => {
            Backend.getNoteMeta.mockResolvedValue({
                ...note,
                parentObject: { type: 'contacts', id: '-OpCUNAMXp-vouR5zak7' },
            })

            await TasksHelper.processURLNoteDetailsTab(navigation, DV_TAB_NOTE_EDITOR, PROJECT_ID, NOTE_ID)

            expectNoteOpened()
        })

        it('still opens a note attached to a task inside its task, keeping the transcription flag', async () => {
            const task = { id: '-Oy32IXsBqnUTWUGv3jd', name: 'Meeting' }
            Backend.getNoteMeta.mockResolvedValue({ ...note, parentObject: { type: 'tasks', id: task.id } })
            jest.spyOn(Backend, 'getTaskData').mockResolvedValue(task)

            await TasksHelper.processURLNoteDetailsTab(navigation, DV_TAB_NOTE_EDITOR, PROJECT_ID, NOTE_ID, null, true)

            expect(navigation.navigate).toHaveBeenCalledWith('TaskDetailedView', {
                task,
                projectId: PROJECT_ID,
                autoStartTranscription: true,
            })
        })

        it('opens the note itself when its parent task cannot be read, instead of doing nothing', async () => {
            Backend.getNoteMeta.mockResolvedValue({ ...note, parentObject: { type: 'tasks', id: 'gone' } })
            jest.spyOn(Backend, 'getTaskData').mockResolvedValue(null)

            await TasksHelper.processURLNoteDetailsTab(navigation, DV_TAB_NOTE_EDITOR, PROJECT_ID, NOTE_ID)

            expectNoteOpened()
        })

        it('opens an attached note from the tabless note URL as well', async () => {
            Backend.getNoteMeta.mockResolvedValue({
                ...note,
                parentObject: { type: 'contacts', id: '-OpCUNAMXp-vouR5zak7' },
            })

            await TasksHelper.processURLNoteDetails(navigation, PROJECT_ID, NOTE_ID)

            expectNoteOpened()
        })
    })

    describe('getNoteDVUserContext', () => {
        it('never returns null, so an unresolvable owner cannot block the note', async () => {
            jest.spyOn(Backend, 'getUserOrContactBy').mockResolvedValue(null)

            const context = await TasksHelper.getNoteDVUserContext(PROJECT_ID, { ...note, userId: ASSISTANT_ID })

            expect(context).not.toBeNull()
            expect(context.uid).toEqual(LOGGED_USER_ID)
        })

        it('falls back to the logged user for a note with no owner recorded', async () => {
            const getOwner = jest.spyOn(Backend, 'getUserOrContactBy').mockResolvedValue(null)

            const context = await TasksHelper.getNoteDVUserContext(PROJECT_ID, { ...note, userId: null })

            expect(getOwner).not.toHaveBeenCalled()
            expect(context.uid).toEqual(LOGGED_USER_ID)
        })
    })
})
