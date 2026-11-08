'use strict'

const { __private__ } = require('./menubarApp')

const { updateExistingMenubarNote } = __private__

// The Mac app's live call coach pushes a "Meeting in progress" note and then
// refreshes it on every coach press via updateIfExists; the final post-call
// sync overwrites it with the full transcript. These tests pin the in-place
// update contract: same note identity, content replaced, existing chat left
// untouched.
function makeDb(initialDocs = {}) {
    const docs = { ...initialDocs }
    return {
        docs,
        doc: path => ({
            get: async () => ({ exists: !!docs[path], data: () => docs[path] }),
            set: async (data, options) => {
                docs[path] = options && options.merge ? { ...(docs[path] || {}), ...data } : data
            },
        }),
    }
}

const assistantActor = {
    assistantId: 'assistant-1',
    feedUser: { uid: 'assistant-1', displayName: 'Anna' },
}

const pushData = {
    userId: 'user-1',
    externalId: 'anna-live-1',
    projectId: 'project-1',
    noteId: 'note-1',
    projectName: 'First project',
    status: 'completed',
    resolution: { source: 'defaultProject', reasoning: null },
}

function makeNoteService(result = { success: true }) {
    return { replaceContentInStorage: jest.fn(async () => result) }
}

describe('updateExistingMenubarNote', () => {
    test('replaces the content and keeps the note identity', async () => {
        const db = makeDb({
            'noteItems/project-1/notes/note-1': { title: 'Meeting in progress — Jul 24, 3:45 PM' },
            'chatObjects/project-1/chats/note-1': {
                title: 'Meeting in progress — Jul 24, 3:45 PM',
                commentsData: { amount: 3 },
            },
        })
        const noteService = makeNoteService()

        const response = await updateExistingMenubarNote(
            db,
            {
                pushData,
                userData: {},
                title: 'Meeting in progress — Jul 24, 3:45 PM',
                content: 'refreshed transcript',
                attachments: [],
                enableAssistantChat: true,
            },
            { noteService, assistantActor }
        )

        expect(response).toMatchObject({
            success: true,
            deduplicated: true,
            updated: true,
            noteId: 'note-1',
            projectId: 'project-1',
            projectName: 'First project',
        })
        expect(response.url).toContain('/projects/project-1/notes/note-1/editor')
        expect(noteService.replaceContentInStorage).toHaveBeenCalledWith(
            'project-1',
            'note-1',
            'refreshed transcript',
            assistantActor.feedUser,
            { editorId: 'assistant-1' }
        )
    })

    test('never re-creates an existing chat (comment counters survive)', async () => {
        const db = makeDb({
            'noteItems/project-1/notes/note-1': { title: 'Old title' },
            'chatObjects/project-1/chats/note-1': {
                title: 'Old title',
                commentsData: { amount: 7, lastComment: 'hi' },
                created: 12345,
            },
        })

        await updateExistingMenubarNote(
            db,
            {
                pushData,
                userData: {},
                title: 'Old title',
                content: 'new content',
                attachments: [],
                enableAssistantChat: true,
            },
            { noteService: makeNoteService(), assistantActor }
        )

        expect(db.docs['chatObjects/project-1/chats/note-1']).toMatchObject({
            commentsData: { amount: 7, lastComment: 'hi' },
            created: 12345,
        })
    })

    test('updates the note title and syncs the existing chat header', async () => {
        const db = makeDb({
            'noteItems/project-1/notes/note-1': { title: 'Meeting in progress — Jul 24, 3:45 PM' },
            'chatObjects/project-1/chats/note-1': {
                title: 'Meeting in progress — Jul 24, 3:45 PM',
                commentsData: { amount: 2 },
            },
        })

        await updateExistingMenubarNote(
            db,
            {
                pushData,
                userData: {},
                title: 'Meeting 2026-07-24 15.45',
                content: 'final transcript',
                attachments: [],
                enableAssistantChat: true,
            },
            { noteService: makeNoteService(), assistantActor }
        )

        expect(db.docs['noteItems/project-1/notes/note-1']).toMatchObject({
            title: 'Meeting 2026-07-24 15.45',
            extendedTitle: 'Meeting 2026-07-24 15.45',
        })
        expect(db.docs['chatObjects/project-1/chats/note-1']).toMatchObject({
            title: 'Meeting 2026-07-24 15.45',
            commentsData: { amount: 2 },
        })
    })

    test('creates the chat once when missing and requested', async () => {
        const db = makeDb({
            'projects/project-1': { userIds: ['user-1'] },
            'noteItems/project-1/notes/note-1': { title: 'Meeting in progress', isPublicFor: ['user-1'] },
        })

        await updateExistingMenubarNote(
            db,
            {
                pushData,
                userData: {},
                title: 'Meeting in progress',
                content: 'transcript',
                attachments: [],
                enableAssistantChat: true,
            },
            { noteService: makeNoteService(), assistantActor }
        )

        expect(db.docs['chatObjects/project-1/chats/note-1']).toMatchObject({
            type: 'notes',
            isAssistantEnabled: true,
            assistantId: 'assistant-1',
            // A private note keeps a private chat.
            isPublicFor: ['user-1'],
        })
    })

    test('returns null when the note was deleted so the caller re-creates it', async () => {
        const db = makeDb({})

        const response = await updateExistingMenubarNote(
            db,
            {
                pushData,
                userData: {},
                title: 'Meeting',
                content: 'transcript',
                attachments: [],
                enableAssistantChat: false,
            },
            { noteService: makeNoteService(), assistantActor }
        )

        expect(response).toBeNull()
    })

    test('throws when replacing the content fails (handler answers 500)', async () => {
        const db = makeDb({
            'noteItems/project-1/notes/note-1': { title: 'Meeting' },
        })

        await expect(
            updateExistingMenubarNote(
                db,
                {
                    pushData,
                    userData: {},
                    title: 'Meeting',
                    content: 'transcript',
                    attachments: [],
                    enableAssistantChat: false,
                },
                {
                    noteService: makeNoteService({ success: false, message: 'storage down' }),
                    assistantActor,
                }
            )
        ).rejects.toThrow('storage down')
    })
})
