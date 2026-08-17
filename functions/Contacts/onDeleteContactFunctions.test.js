'use strict'

const mockDeleteChat = jest.fn(async () => {})
const mockDeleteNote = jest.fn(async () => {})
const mockMoveNoteToDifferentProject = jest.fn(async () => {})
const mockDeleteRecord = jest.fn(async () => {})
const mockRemoveObjectFromBacklinks = jest.fn(async () => {})
const mockDeleteOpenManagedFollowUpTasks = jest.fn(async () => {})
const mockDeleteFiles = jest.fn(async () => {})
const mockFirestore = { name: 'firestore' }
const mockStorage = {
    bucket: jest.fn(() => ({ deleteFiles: mockDeleteFiles })),
}

jest.mock('firebase-admin', () => ({
    firestore: () => mockFirestore,
    storage: () => mockStorage,
}))
jest.mock('firebase-functions/params', () => ({
    defineString: () => ({ value: () => 'notescontentprod' }),
}))
jest.mock('../AlgoliaGlobalSearchHelper', () => ({
    CONTACTS_OBJECTS_TYPE: 'contacts',
    deleteRecord: (...args) => mockDeleteRecord(...args),
}))
jest.mock('../Backlinks/backlinksHelper', () => ({
    removeObjectFromBacklinks: (...args) => mockRemoveObjectFromBacklinks(...args),
}))
jest.mock('../Chats/chatsFirestoreCloud', () => ({
    deleteChat: (...args) => mockDeleteChat(...args),
}))
jest.mock('../Notes/notesFirestoreCloud', () => ({
    deleteNote: (...args) => mockDeleteNote(...args),
}))
jest.mock('../shared/moveNoteToDifferentProject', () => ({
    moveNoteToDifferentProject: (...args) => mockMoveNoteToDifferentProject(...args),
}))
jest.mock('./contactFollowUpTasks', () => ({
    deleteOpenManagedFollowUpTasks: (...args) => mockDeleteOpenManagedFollowUpTasks(...args),
}))

const { onDeleteContact } = require('./onDeleteContactFunctions')

describe('onDeleteContact', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        jest.spyOn(console, 'log').mockImplementation(() => {})
    })

    afterEach(() => {
        console.log.mockRestore()
    })

    it('moves the linked note when the contact is moving to another project', async () => {
        await onDeleteContact('project-a', {
            uid: 'contact-1',
            noteId: 'note-1',
            movingToOtherProjectId: 'project-b',
        })

        expect(mockMoveNoteToDifferentProject).toHaveBeenCalledWith({
            database: mockFirestore,
            storage: mockStorage,
            sourceProjectId: 'project-a',
            targetProjectId: 'project-b',
            noteId: 'note-1',
            notesBucketName: 'notescontentprod',
        })
        expect(mockDeleteNote).not.toHaveBeenCalled()
    })

    it('deletes the linked note normally when the contact is not moving', async () => {
        await onDeleteContact('project-a', {
            uid: 'contact-1',
            noteId: 'note-1',
        })

        expect(mockDeleteNote).toHaveBeenCalledWith('project-a', 'note-1', '', expect.anything())
        expect(mockMoveNoteToDifferentProject).not.toHaveBeenCalled()
    })
})
