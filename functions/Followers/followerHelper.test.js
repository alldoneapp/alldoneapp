let mockArrayUnion

jest.mock('firebase-admin/firestore', () => ({
    FieldValue: {
        arrayUnion: (...values) => mockArrayUnion(...values),
    },
}))

jest.mock('../Feeds/tasksFeeds', () => ({
    createTaskFollowedFeed: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../Feeds/goalsFeeds', () => ({
    createGoalFollowedFeed: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../Feeds/contactsFeeds', () => ({
    createContactFollowedFeed: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../Feeds/notesFeeds', () => ({
    createNoteFollowedFeed: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../Feeds/assistantsFeeds', () => ({
    createAssistantFollowedFeed: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../Feeds/globalFeedsHelper', () => ({
    getFeedObjectLastState: jest.fn(),
    deleteObjectFeedCounter: jest.fn(),
}))
jest.mock('../GlobalState/globalState', () => ({
    getGlobalState: jest.fn(),
}))
jest.mock('../Utils/HelperFunctionsCloud', () => ({
    FEED_PUBLIC_FOR_ALL: 0,
}))

const { createTaskFollowedFeed } = require('../Feeds/tasksFeeds')
const { getGlobalState } = require('../GlobalState/globalState')
const { tryAddFollower } = require('./followerHelper')

describe('followerHelper', () => {
    let batch
    let chatUpdate
    let chatData
    let firestoreDoc

    beforeEach(() => {
        jest.clearAllMocks()
        mockArrayUnion = jest.fn(value => ({ arrayUnion: value }))
        batch = { set: jest.fn() }
        chatUpdate = jest.fn().mockResolvedValue(undefined)
        chatData = { usersFollowing: ['user-1'] }
        firestoreDoc = jest.fn(path => {
            if (path === 'followers/project-1/tasks/task-1') {
                return { get: jest.fn().mockResolvedValue({ data: () => undefined }) }
            }
            if (path === 'chatObjects/project-1/chats/task-1') {
                return {
                    get: jest.fn().mockResolvedValue({ exists: true, data: () => chatData }),
                    update: chatUpdate,
                }
            }
            return {}
        })
        getGlobalState.mockReturnValue({
            admin: { firestore: { FieldValue: { arrayUnion: mockArrayUnion } } },
            appAdmin: { firestore: () => ({ doc: firestoreDoc }) },
        })
    })

    test('does not update a chat that already contains the follower', async () => {
        await tryAddFollower(
            'project-1',
            {
                followObjectsType: 'tasks',
                followObjectId: 'task-1',
                followObject: { subtaskIds: [] },
                feedUser: { uid: 'user-1' },
            },
            batch,
            true
        )

        expect(chatUpdate).not.toHaveBeenCalled()
        expect(createTaskFollowedFeed).toHaveBeenCalled()
        expect(batch.set).toHaveBeenCalledWith(expect.anything(), { tasks: { 'task-1': true } }, { merge: true })
    })

    test('adds the follower when a chat has no usersFollowing array', async () => {
        chatData = {}

        await tryAddFollower(
            'project-1',
            {
                followObjectsType: 'tasks',
                followObjectId: 'task-1',
                followObject: { subtaskIds: [] },
                feedUser: { uid: 'user-1' },
            },
            batch,
            true
        )

        expect(mockArrayUnion).toHaveBeenCalledWith('user-1')
        expect(chatUpdate).toHaveBeenCalledWith({ usersFollowing: { arrayUnion: 'user-1' } })
    })

    test('adds an artifact follower to the artifact so it shows in their Followed list', async () => {
        const artifactSet = jest.fn()
        firestoreDoc.mockImplementation(path => {
            if (path === 'followers/project-1/artifacts/artifact-1') {
                return { get: jest.fn().mockResolvedValue({ data: () => undefined }) }
            }
            if (path === 'artifactItems/project-1/artifacts/artifact-1') return { set: artifactSet }
            if (path === 'chatObjects/project-1/chats/artifact-1') {
                return { get: jest.fn().mockResolvedValue({ exists: false }) }
            }
            return {}
        })

        await tryAddFollower(
            'project-1',
            {
                followObjectsType: 'artifacts',
                followObjectId: 'artifact-1',
                followObject: { isPublicFor: [0, 'owner'] },
                feedUser: { uid: 'user-2' },
            },
            batch,
            true
        )

        expect(artifactSet).toHaveBeenCalledWith(
            { followersIds: { arrayUnion: 'user-2' }, isVisibleInFollowedFor: { arrayUnion: 'user-2' } },
            { merge: true }
        )
    })

    test('never makes a private artifact visible to a follower who cannot read it', async () => {
        const artifactSet = jest.fn()
        firestoreDoc.mockImplementation(path => {
            if (path === 'followers/project-1/artifacts/private-1') {
                return { get: jest.fn().mockResolvedValue({ data: () => undefined }) }
            }
            if (path === 'artifactItems/project-1/artifacts/private-1') return { set: artifactSet }
            if (path === 'chatObjects/project-1/chats/private-1') {
                return { get: jest.fn().mockResolvedValue({ exists: false }) }
            }
            return {}
        })

        await tryAddFollower(
            'project-1',
            {
                followObjectsType: 'artifacts',
                followObjectId: 'private-1',
                followObject: { isPublicFor: ['owner'] },
                feedUser: { uid: 'user-2' },
            },
            batch,
            true
        )

        expect(artifactSet).toHaveBeenCalledWith({ followersIds: { arrayUnion: 'user-2' } }, { merge: true })
    })
})
