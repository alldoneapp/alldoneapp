const mockDeleteNote = jest.fn(async () => {})
const mockDeleteRecord = jest.fn(async () => {})
const mockRemoveObjectFollowData = jest.fn(async () => {})
const mockRecursiveDeleteHelper = jest.fn(async () => {})
const mockTransaction = {
    get: jest.fn(async () => ({ exists: false })),
}
const mockFirestore = {
    doc: jest.fn(() => ({})),
    runTransaction: jest.fn(callback => callback(mockTransaction)),
}

jest.mock('firebase-admin', () => ({ firestore: () => mockFirestore }))
jest.mock('firebase-tools', () => ({}))
jest.mock('../AlgoliaGlobalSearchHelper', () => ({
    CHATS_OBJECTS_TYPE: 'chats',
    deleteRecord: (...args) => mockDeleteRecord(...args),
}))
jest.mock('../Followers/followersFirestoreCloud', () => ({
    removeObjectFollowData: (...args) => mockRemoveObjectFollowData(...args),
}))
jest.mock('../Notes/notesFirestoreCloud', () => ({
    deleteNote: (...args) => mockDeleteNote(...args),
}))
jest.mock('../Utils/HelperFunctionsCloud', () => ({
    recursiveDeleteHelper: (...args) => mockRecursiveDeleteHelper(...args),
}))
jest.mock('../Utils/LastObjectEditionHelper', () => ({
    updateEditonDataOfChatParentObject: jest.fn(async () => {}),
    resetLastCommentDataOfChatParentObject: jest.fn(async () => {}),
}))
jest.mock('./chatsFirestoreCloud', () => ({
    deleteChatNotifications: jest.fn(async () => {}),
}))

const { onDeleteChat } = require('./onDeleteChatFunctions')

describe('onDeleteChat', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('moves the linked note when the chat is moving to another project', async () => {
        await onDeleteChat('project-a', {
            id: 'chat-1',
            type: 'topics',
            noteId: 'note-1',
            movingToOtherProjectId: 'project-b',
        })

        expect(mockDeleteNote).toHaveBeenCalledWith('project-a', 'note-1', 'project-b', expect.anything())
    })

    it('deletes the linked note normally when the chat is not moving', async () => {
        await onDeleteChat('project-a', {
            id: 'chat-1',
            type: 'topics',
            noteId: 'note-1',
        })

        expect(mockDeleteNote).toHaveBeenCalledWith('project-a', 'note-1', '', expect.anything())
    })
})
