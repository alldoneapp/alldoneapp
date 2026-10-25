import { createObjectMessage, getParentObjectData, sendQueuedObjectMessage } from './chatsComments'
import { commentOutbox } from './commentOutbox'
import { getDb, runHttpsCallableFunction } from '../firestore'
import { getChatMeta } from './chatsFirestore'
import { getArtifactData } from '../Artifacts/artifactsFirestore'

// An artifact is a chat parent like a note or a skill: its comments live under the `artifacts` chat
// type, its chat object carries the artifact's audience, and the artifact keeps the last-comment
// preview the list shows. firestore.rules accepts exactly these paths (see the "comments on an
// artifact" block of the rules emulator suite).

jest.mock('firebase/compat/app', () => ({
    firestore: {
        FieldValue: { increment: value => ({ increment: value }), arrayUnion: (...values) => ({ union: values }) },
    },
}))
jest.mock('../firestore', () => ({
    getDb: jest.fn(),
    getTaskData: jest.fn(),
    getId: () => 'stable-id',
    getFirestoreTime: () => 123,
    logEvent: jest.fn(),
    tryAddFollower: jest.fn(),
    runHttpsCallableFunction: jest.fn(),
}))
jest.mock('../../../redux/store', () => ({ getState: () => ({ loggedUser: { uid: 'u', displayName: 'User' } }) }))
jest.mock('../../../components/TaskListView/Utils/TasksHelper', () => ({
    __esModule: true,
    default: {
        getUserInProject: () => ({ uid: 'u' }),
        getMentionIdsFromTitle: () => [],
        getTaskNameWithoutMeta: value => value,
    },
}))
jest.mock('../Assistants/assistantsFirestore', () => ({}))
jest.mock('../Goals/goalsFirestore', () => ({}))
jest.mock('../Skills/skillsFirestore', () => ({}))
jest.mock('../Artifacts/artifactsFirestore', () => ({
    getArtifactData: jest.fn(),
    setArtifactAssistant: jest.fn(),
    updateArtifactLastCommentData: jest.fn(),
    resetArtifactLastCommentData: jest.fn(),
}))
jest.mock('../Notes/notesFirestore', () => ({}))
jest.mock('../Contacts/contactsFirestore', () => ({}))
jest.mock('../Projects/projectsFirestore', () => ({}))
jest.mock('../Tasks/tasksFirestore', () => ({ createGenericTaskWhenMention: jest.fn() }))
jest.mock('../Users/usersFirestore', () => ({
    updateUserDataDirectly: (userId, data, batch) => batch.update({ path: `users/${userId}` }, data),
}))
jest.mock('./chatsFirestore', () => ({ getChatMeta: jest.fn() }))
jest.mock('../../../components/AdminPanel/Assistants/assistantsHelper', () => ({
    resolveAssistantForProjectObject: (projectId, assistantId) => ({ uid: assistantId || 'assistant' }),
    isGlobalAssistant: id => id === 'global-assistant',
    getAssistantInProject: () => ({ creatorId: 'u', displayName: 'Global assistant' }),
}))
jest.mock('../../../components/ChatsView/Utils/ChatHelper', () => ({ getLinkedParentChatUrl: () => '/chat' }))
jest.mock('../../../components/ChatsView/Utils/assistantEnabledScope', () => ({
    selectAssistantEnabledFor: () => false,
}))
jest.mock('../../../components/ChatsView/Utils/botSpinnerTrigger', () => ({ endBotSpinnerWait: jest.fn() }))
jest.mock('../../../components/SettingsView/ProjectsSettings/ProjectsSettings', () => ({ PROJECT_TYPE_GUIDE: 'guide' }))
jest.mock('../../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    getTypeOfProject: () => 'normal',
    getProjectById: () => ({ name: 'Project' }),
}))
jest.mock('../../assistantHelper', () => ({ generateUserIdsToNotifyForNewComments: () => ['other-user'] }))
jest.mock('../Feeds/activityFeedReadState', () => ({
    isNewComment: id => !id,
    queueObjectActivityFeedUnreadClear: jest.fn(),
}))
jest.mock('../../../functions/Utils/parseTextUtils', () => ({
    cleanTextMetaData: text => text,
    removeFormatTagsFromText: text => text,
    shrinkTagText: text => text,
    extractMediaContextFromText: () => [],
    LAST_COMMENT_CHARACTER_LIMIT_IN_BIG_SCREEN: 100,
}))

let docs, commits

const ARTIFACT = {
    id: 'a',
    title: 'Sales dashboard',
    userId: 'owner',
    creatorId: 'owner',
    isPublicFor: [0, 'owner'],
    assistantId: 'artifact-assistant',
    isAssistantEnabled: false,
}

beforeEach(() => {
    localStorage.clear()
    jest.clearAllMocks()
    docs = new Map()
    commits = []
    getChatMeta.mockResolvedValue(null)
    getArtifactData.mockResolvedValue(ARTIFACT)
    getDb.mockReturnValue({
        doc: path => ({ path, get: async () => ({ data: () => ({ usersFollowing: ['u'] }) }) }),
        runTransaction: async callback => {
            const writes = []
            const result = await callback({
                get: async ref => ({ exists: docs.has(ref.path), data: () => docs.get(ref.path) }),
                set: (ref, data) => writes.push({ path: ref.path, data }),
                update: (ref, data) => writes.push({ path: ref.path, data }),
            })
            if (writes.length) {
                commits.push(writes)
                writes.forEach(({ path, data }) => docs.set(path, data))
            }
            return result
        },
    })
    commentOutbox.configure({ activeUser: () => 'u', canSend: () => false, send: sendQueuedObjectMessage })
})

const goOnline = () =>
    commentOutbox.configure({ activeUser: () => 'u', canSend: () => true, send: sendQueuedObjectMessage })

it('describes an artifact as a chat parent', async () => {
    await expect(getParentObjectData('p', 'a', 'artifacts')).resolves.toEqual({
        object: ARTIFACT,
        isPublicFor: [0, 'owner'],
        assistantId: 'artifact-assistant',
        parentObjectCreatorId: 'owner',
        title: 'Sales dashboard',
        followObjectsType: 'artifacts',
    })
    getArtifactData.mockResolvedValueOnce(null)
    await expect(getParentObjectData('p', 'gone', 'artifacts')).resolves.toMatchObject({
        object: null,
        followObjectsType: null,
    })
})

it('stores a comment on an artifact under the artifact chat type and updates its preview', async () => {
    await createObjectMessage('p', 'a', 'Make the chart blue', 'artifacts', 'comment')
    goOnline()
    await commentOutbox.flush()

    expect(commits).toHaveLength(1)
    expect(docs.get('chatComments/p/artifacts/a/comments/stable-id')).toMatchObject({
        commentText: 'Make the chart blue',
        creatorId: 'u',
    })
    expect(docs.get('chatObjects/p/chats/a')).toMatchObject({
        id: 'a',
        type: 'artifacts',
        title: 'Sales dashboard',
        isPublicFor: [0, 'owner'],
        creatorId: 'owner',
        assistantId: 'artifact-assistant',
    })
    expect(docs.get('artifactItems/p/artifacts/a')).toEqual({
        'commentsData.lastComment': 'Make the chart blue',
        'commentsData.lastCommentType': 'comment',
        'commentsData.amount': { increment: 1 },
    })
    expect(docs.has('chatNotifications/p/other-user/stable-id')).toBe(true)
    expect(Array.from(docs.keys()).some(path => path.includes('/topics/'))).toBe(false)
    expect(runHttpsCallableFunction).not.toHaveBeenCalled()
})

it('asks the artifact assistant when the artifact chat has it switched on', async () => {
    getArtifactData.mockResolvedValue({ ...ARTIFACT, isAssistantEnabled: true })
    runHttpsCallableFunction.mockResolvedValue({})
    await createObjectMessage('p', 'a', 'Add a monthly view', 'artifacts', 'comment')
    goOnline()
    await commentOutbox.flush()

    expect(runHttpsCallableFunction).toHaveBeenCalledTimes(1)
    expect(runHttpsCallableFunction).toHaveBeenCalledWith(
        'askToBotSecondGen',
        expect.objectContaining({
            projectId: 'p',
            objectId: 'a',
            objectType: 'artifacts',
            assistantId: 'artifact-assistant',
            isPublicFor: [0, 'owner'],
        }),
        expect.any(Object)
    )
})
