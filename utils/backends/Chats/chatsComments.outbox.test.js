import { createObjectMessage, sendQueuedObjectMessage } from './chatsComments'
import { commentOutbox } from './commentOutbox'
import { getDb, getTaskData, runHttpsCallableFunction } from '../firestore'
import { getChatMeta } from './chatsFirestore'

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
jest.mock('../Notes/notesFirestore', () => ({}))
jest.mock('../Contacts/contactsFirestore', () => ({}))
jest.mock('../Projects/projectsFirestore', () => ({}))
jest.mock('../Tasks/tasksFirestore', () => ({ createGenericTaskWhenMention: jest.fn() }))
jest.mock('../Users/usersFirestore', () => ({
    updateUserDataDirectly: (userId, data, batch) => batch.update({ path: `users/${userId}` }, data),
}))
jest.mock('./chatsFirestore', () => ({ getChatMeta: jest.fn() }))
jest.mock('../../../components/AdminPanel/Assistants/assistantsHelper', () => ({
    resolveAssistantForProjectObject: () => ({ uid: 'assistant' }),
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

let docs, commits, rejectCommit, loseAcknowledgement
beforeEach(() => {
    localStorage.clear()
    jest.clearAllMocks()
    docs = new Map()
    commits = []
    rejectCommit = null
    loseAcknowledgement = false
    getChatMeta.mockResolvedValue(null)
    getTaskData.mockResolvedValue({
        isPublicFor: [0],
        assistantId: 'assistant',
        creatorId: 'u',
        extendedName: 'Task',
        isAssistantEnabled: false,
    })
    const db = {
        doc: path => ({ path, get: async () => ({ data: () => ({ usersFollowing: ['u'] }) }) }),
        runTransaction: async callback => {
            const writes = []
            const result = await callback({
                get: async ref => ({ exists: docs.has(ref.path), data: () => docs.get(ref.path) }),
                set: (ref, data) => writes.push({ path: ref.path, data }),
                update: (ref, data) => writes.push({ path: ref.path, data }),
            })
            if (rejectCommit) throw rejectCommit
            if (writes.length) {
                commits.push(writes)
                writes.forEach(({ path, data }) => docs.set(path, data))
            }
            if (loseAcknowledgement) {
                loseAcknowledgement = false
                throw Object.assign(new Error('Lost acknowledgement'), { code: 'unavailable' })
            }
            return result
        },
    }
    getDb.mockReturnValue(db)
    commentOutbox.configure({ activeUser: () => 'u', canSend: () => false, send: sendQueuedObjectMessage })
})

const submit = () => createObjectMessage('p', 't', 'Keep our chat interface', 'tasks', 'comment')
const goOnline = () =>
    commentOutbox.configure({ activeUser: () => 'u', canSend: () => true, send: sendQueuedObjectMessage })

it('durably accepts offline text before parent reads and retries a failed cold-cache read', async () => {
    await expect(submit()).resolves.toBe('stable-id')
    expect(getTaskData).not.toHaveBeenCalled()
    expect(commentOutbox.list('u')[0].comment).toBe('Keep our chat interface')
    getTaskData.mockRejectedValueOnce(Object.assign(new Error('Offline cache miss'), { code: 'unavailable' }))
    goOnline()
    await commentOutbox.flush()
    expect(commits).toHaveLength(0)
    expect(commentOutbox.list('u')).toHaveLength(1)
    await commentOutbox.flush()
    expect(docs.get('chatComments/p/tasks/t/comments/stable-id').commentText).toBe('Keep our chat interface')
    expect(commentOutbox.list('u')).toHaveLength(0)
})

it('a lost acknowledgement retries the same comment without duplicating counters or notifications', async () => {
    await submit()
    loseAcknowledgement = true
    goOnline()
    await commentOutbox.flush()
    expect(commentOutbox.list('u')).toHaveLength(1)
    await commentOutbox.flush()
    expect(commentOutbox.list('u')).toHaveLength(0)
    expect(commits).toHaveLength(1)
    expect(commits[0].map(write => write.path)).toEqual(
        expect.arrayContaining([
            'chatComments/p/tasks/t/comments/stable-id',
            'chatObjects/p/chats/t',
            'items/p/tasks/t',
            'chatNotifications/p/other-user/stable-id',
        ])
    )
    expect(runHttpsCallableFunction).not.toHaveBeenCalled()
})

it('retains rejected comments for explicit retry without publishing partial metadata', async () => {
    await submit()
    rejectCommit = { code: 'permission-denied' }
    goOnline()
    await commentOutbox.flush()
    expect(docs.size).toBe(0)
    expect(commentOutbox.list('u')[0]).toMatchObject({ status: 'failed', comment: 'Keep our chat interface' })
    rejectCommit = null
    await commentOutbox.retry('u', 'stable-id')
    expect(commits).toHaveLength(1)
    expect(commentOutbox.list('u')).toHaveLength(0)
})

it('does not replace a newer preview when an older offline comment is finally delivered', async () => {
    await submit()
    docs.set('chatObjects/p/chats/t', { lastEditionDate: Date.now() + 10000, members: ['u'], commentsData: {} })
    goOnline()
    await commentOutbox.flush()
    const parentUpdate = commits[0].find(write => write.path === 'items/p/tasks/t').data
    expect(parentUpdate).toEqual({ 'commentsData.amount': { increment: 1 } })
    const chatUpdate = commits[0].find(write => write.path === 'chatObjects/p/chats/t').data
    expect(chatUpdate).not.toHaveProperty('commentsData')
    expect(chatUpdate).not.toHaveProperty('lastEditionDate')
})

it('saves a global assistant conversation without trying to update a nonexistent project-local assistant', async () => {
    await createObjectMessage('p', 'global-assistant', 'Hello', 'assistants', null, null, null, true)
    goOnline()
    await commentOutbox.flush()
    expect(commentOutbox.list('u')).toHaveLength(0)
    expect(commits[0].some(write => write.path === 'assistants/p/items/global-assistant')).toBe(false)
    expect(docs.has('chatComments/p/assistants/global-assistant/comments/stable-id')).toBe(true)
})
