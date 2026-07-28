jest.mock('firebase-admin', () => {
    const update = jest.fn(() => Promise.resolve())
    const get = jest.fn(() =>
        Promise.resolve({
            exists: true,
            data: () => ({ type: 'notes', title: 'Old title' }),
        })
    )
    const doc = jest.fn(() => ({ get, update }))
    const firestore = jest.fn(() => ({ doc }))

    return {
        firestore,
        __mock: {
            doc,
            get,
            update,
        },
    }
})

jest.mock('../AlgoliaGlobalSearchHelper', () => ({
    NOTES_OBJECTS_TYPE: 'notes',
    updateRecord: jest.fn(() => Promise.resolve()),
}))

jest.mock('../Utils/LastObjectEditionHelper', () => ({
    updateEditonDataOfNoteParentObject: jest.fn(() => Promise.resolve()),
}))

const admin = require('firebase-admin')
const { updateRecord } = require('../AlgoliaGlobalSearchHelper')
const { onUpdateNote, syncNoteChatTitle } = require('./onUpdateNoteFunctions')

const makeChange = (before, after) => ({
    before: { data: () => before },
    after: { data: () => after },
})

describe('note chat title synchronization', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        admin.__mock.get.mockResolvedValue({
            exists: true,
            data: () => ({ type: 'notes', title: 'Old title' }),
        })
    })

    test('updates the existing note chat when the display title changes', async () => {
        await onUpdateNote(
            'project-1',
            'note-1',
            makeChange(
                { title: 'old title', extendedTitle: 'Old title' },
                { title: 'new title', extendedTitle: 'New title' }
            )
        )

        expect(admin.__mock.doc).toHaveBeenCalledWith('chatObjects/project-1/chats/note-1')
        expect(admin.__mock.update).toHaveBeenCalledWith({ title: 'New title' })
        expect(updateRecord).toHaveBeenCalledWith(
            'project-1',
            'note-1',
            { title: 'old title', extendedTitle: 'Old title' },
            { title: 'new title', extendedTitle: 'New title' },
            'notes',
            expect.any(Object)
        )
    })

    test('falls back to the normalized title when extendedTitle is unavailable', async () => {
        await syncNoteChatTitle(
            'project-1',
            'note-1',
            { title: 'old title' },
            { title: 'new title' },
            admin.firestore()
        )

        expect(admin.__mock.update).toHaveBeenCalledWith({ title: 'new title' })
    })

    test('does not read or update a chat for content-only note changes', async () => {
        await syncNoteChatTitle(
            'project-1',
            'note-1',
            { title: 'title', extendedTitle: 'Title', preview: 'Before' },
            { title: 'title', extendedTitle: 'Title', preview: 'After' },
            admin.firestore()
        )

        expect(admin.__mock.doc).not.toHaveBeenCalled()
        expect(admin.__mock.update).not.toHaveBeenCalled()
    })

    test('does not create a chat when the note has no chat object', async () => {
        admin.__mock.get.mockResolvedValue({
            exists: false,
            data: () => undefined,
        })

        await syncNoteChatTitle(
            'project-1',
            'note-1',
            { extendedTitle: 'Old title' },
            { extendedTitle: 'New title' },
            admin.firestore()
        )

        expect(admin.__mock.update).not.toHaveBeenCalled()
    })

    test('preserves chat objects belonging to other object types', async () => {
        admin.__mock.get.mockResolvedValue({
            exists: true,
            data: () => ({ type: 'tasks', title: 'Task title' }),
        })

        await syncNoteChatTitle(
            'project-1',
            'note-1',
            { extendedTitle: 'Old title' },
            { extendedTitle: 'New title' },
            admin.firestore()
        )

        expect(admin.__mock.update).not.toHaveBeenCalled()
    })
})
