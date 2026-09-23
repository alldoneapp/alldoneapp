'use strict'

const mockMoveNote = jest.fn(async () => {})
const mockCopyChat = jest.fn(async () => {})

jest.mock('./moveNoteToDifferentProject', () => ({ moveNoteToDifferentProject: (...args) => mockMoveNote(...args) }))
jest.mock('../Chats/copyProjectMoveChat', () => ({ copyProjectMoveChat: (...args) => mockCopyChat(...args) }))
jest.mock('./notesStorageBucket', () => ({ getNotesBucketName: () => 'notes-bucket' }))

const { moveObjectToDifferentProject } = require('./moveObjectToDifferentProject')

test.each(['new destination', 'retry with stale target projection'])(
    'moves a private contact through the server (%s)',
    async scenario => {
        jest.clearAllMocks()
        const documents = {
            'projects/source': { userIds: ['actor', 'source-only'] },
            'projects/target': { userIds: ['actor', 'target-member'] },
            'users/actor': { displayName: 'Mover' },
            'projectsContacts/source/contacts/contact-1': {
                uid: 'contact-1',
                isPublicFor: ['actor', 'source-only', 'target-member'],
                readerIds: ['actor', 'source-only'],
                noteId: 'note-1',
            },
            ...(scenario === 'retry with stale target projection'
                ? {
                      'projectsContacts/target/contacts/contact-1': {
                          projectMove: { requestId: 'request-1', status: 'moving' },
                          readerIds: ['source-only'],
                          roleIdsVisibleTo: { 'source-only': [] },
                      },
                  }
                : {}),
        }
        const writes = []
        const database = {
            doc: path => ({
                get: async () => ({ exists: path in documents, data: () => documents[path] }),
                set: async (data, options) => {
                    documents[path] = options?.merge ? { ...documents[path], ...data } : data
                    writes.push(['set', path])
                },
                delete: async () => {
                    delete documents[path]
                    writes.push(['delete', path])
                },
            }),
        }
        const copyInnerFeeds = jest.fn(async () => {})

        await moveObjectToDifferentProject({
            database,
            sourceProjectId: 'source',
            targetProjectId: 'target',
            objectType: 'contact',
            objectId: 'contact-1',
            actorId: 'actor',
            requestId: 'request-1',
            copyInnerFeeds,
        })

        const moved = documents['projectsContacts/target/contacts/contact-1']
        expect(moved.isPublicFor).toEqual(['actor', 'target-member'])
        expect(moved.readerIds).toBeUndefined()
        expect(moved.roleIdsVisibleTo).toBeUndefined()
        expect(moved.projectMove.status).toBe('completed')
        expect(mockMoveNote).toHaveBeenCalledWith(
            expect.objectContaining({
                targetProjectUserIds: ['actor', 'target-member'],
                editorId: 'actor',
                noteId: 'note-1',
            })
        )
        expect(mockCopyChat).toHaveBeenCalledWith(expect.objectContaining({ objectType: 'contacts', actorId: 'actor' }))
        expect(copyInnerFeeds).toHaveBeenCalledWith(expect.anything(), 'source', 'target', 'contacts', 'contact-1')
        expect(documents['projectsContacts/source/contacts/contact-1']).toBeUndefined()
        expect(writes).toEqual([
            ['set', 'projectsContacts/source/contacts/contact-1'],
            ['set', 'projectsContacts/target/contacts/contact-1'],
            ['delete', 'projectsContacts/source/contacts/contact-1'],
            ['set', 'projectsContacts/target/contacts/contact-1'],
        ])
    }
)
