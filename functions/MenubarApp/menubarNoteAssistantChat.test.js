'use strict'

const { __private__ } = require('./menubarApp')

const { enableNoteAssistantChat, resolveMenubarConversationTarget } = __private__

// A note pushed from the Mac app has no chat object of its own, so a follow-up
// prompt targeting it used to be rejected outright. These tests pin the contract
// between the chat the push creates and the resolver the comment path runs.
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

const NOTE = {
    projectId: 'project-1',
    noteId: 'note-1',
    title: 'Meeting at 3:45 PM',
    userId: 'user-1',
    assistantId: 'assistant-1',
}

describe('note assistant chat created on push', () => {
    test('produces a chat the conversation target resolver accepts', async () => {
        const db = makeDb({
            'projects/project-1': { userIds: ['user-1'], name: 'First project' },
            'noteItems/project-1/notes/note-1': { title: 'Meeting at 3:45 PM' },
        })

        await enableNoteAssistantChat(db, NOTE)

        await expect(
            resolveMenubarConversationTarget(db, 'user-1', {
                projectId: 'project-1',
                objectId: 'note-1',
                objectType: 'notes',
            })
        ).resolves.toMatchObject({
            projectId: 'project-1',
            chatId: 'note-1',
            objectType: 'notes',
            assistantId: 'assistant-1',
            // Without this the comment lands but no assistant ever answers it.
            assistantReplyEnabled: true,
        })
    })

    test('marks the note itself assistant-enabled for the web UI', async () => {
        const db = makeDb({
            'projects/project-1': { userIds: ['user-1'] },
            'noteItems/project-1/notes/note-1': { title: 'Meeting at 3:45 PM' },
        })

        await enableNoteAssistantChat(db, NOTE)

        expect(db.docs['noteItems/project-1/notes/note-1']).toMatchObject({
            title: 'Meeting at 3:45 PM',
            isAssistantEnabled: true,
        })
        expect(db.docs['usersFollowing/project-1/entries/user-1']).toMatchObject({
            notes: { 'note-1': true },
        })
    })

    test('keeps a private note chat visible only to its owner', async () => {
        const db = makeDb({
            'projects/project-1': { userIds: ['user-1', 'user-2'] },
            'noteItems/project-1/notes/note-1': { title: 'Meeting at 3:45 PM' },
        })

        await enableNoteAssistantChat(db, { ...NOTE, isPublicFor: ['user-1'] })

        expect(db.docs['chatObjects/project-1/chats/note-1'].isPublicFor).toEqual(['user-1'])
        await expect(
            resolveMenubarConversationTarget(db, 'user-2', {
                projectId: 'project-1',
                objectId: 'note-1',
                objectType: 'notes',
            })
        ).resolves.toBeNull()
    })

    test('types the chat as a note so a mismatched target is still refused', async () => {
        const db = makeDb({
            'projects/project-1': { userIds: ['user-1'] },
            'noteItems/project-1/notes/note-1': {},
        })

        await enableNoteAssistantChat(db, NOTE)
        expect(db.docs['chatObjects/project-1/chats/note-1']).toMatchObject({ type: 'notes' })

        await expect(
            resolveMenubarConversationTarget(db, 'user-1', {
                projectId: 'project-1',
                objectId: 'note-1',
                objectType: 'tasks',
            })
        ).resolves.toBeNull()
    })

    test('keeps the chat out of reach for users outside the project', async () => {
        const db = makeDb({
            'projects/project-1': { userIds: ['user-1'] },
            'noteItems/project-1/notes/note-1': {},
        })

        await enableNoteAssistantChat(db, NOTE)

        await expect(
            resolveMenubarConversationTarget(db, 'intruder', {
                projectId: 'project-1',
                objectId: 'note-1',
                objectType: 'notes',
            })
        ).resolves.toBeNull()
    })
})
