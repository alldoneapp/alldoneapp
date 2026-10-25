import {
    resetArtifactLastCommentData,
    setArtifactAssistant,
    setArtifactPrivacy,
    updateArtifactLastCommentData,
    watchArtifactBacklinks,
} from './artifactsFirestore'
import { getDb } from '../firestore'
import { updateChatAssistantWithoutFeeds, updateChatPrivacy } from '../Chats/chatsFirestore'

jest.mock('firebase/compat/app', () => ({
    firestore: {
        FieldValue: { increment: value => ({ increment: value }) },
        FieldPath: class {
            constructor(...segments) {
                this.segments = segments
            }
        },
    },
}))
jest.mock('../firestore', () => ({
    getDb: jest.fn(),
    getFirebaseProjectId: () => 'demo',
    getFunctionsRegion: () => 'europe-west1',
    getLoggedUserAccessReaderId: () => 'u',
    runHttpsCallableFunction: jest.fn(),
}))
jest.mock('../Premium/premiumFirestore', () => ({ updateQuotaTraffic: jest.fn() }))
jest.mock('../offlineWriteAck', () => ({ awaitWriteAck: write => write }))
jest.mock('../../firebaseEmulators', () => ({ shouldUseFirebaseEmulators: () => false }))
jest.mock('../../../redux/store', () => ({ getState: () => ({ loggedUser: { uid: 'owner' } }) }))
jest.mock('../Chats/chatsFirestore', () => ({
    updateChatPrivacy: jest.fn(() => Promise.resolve()),
    updateChatAssistantWithoutFeeds: jest.fn((projectId, chatId, assistantId, batch) => {
        batch.update({ path: `chatObjects/${projectId}/chats/${chatId}` }, { assistantId })
        return Promise.resolve()
    }),
}))

let docs, writes, commits

beforeEach(() => {
    jest.clearAllMocks()
    docs = new Map()
    writes = []
    commits = []
    getDb.mockReturnValue({
        doc: path => ({
            path,
            get: async () => ({ exists: docs.has(path), id: path.split('/').pop(), data: () => docs.get(path) }),
            update: async data => writes.push({ path, data }),
        }),
        batch: () => {
            const staged = []
            return {
                update: (ref, data) => staged.push({ path: ref.path, data }),
                set: (ref, data) => staged.push({ path: ref.path, data }),
                commit: async () => commits.push(staged),
            }
        },
    })
})

it('takes the artifact chat along when the artifact turns private', async () => {
    await setArtifactPrivacy('p', { id: 'a', userId: 'owner' }, true)
    expect(updateChatPrivacy).toHaveBeenCalledWith('p', 'a', 'artifacts', ['owner'])
    expect(writes).toEqual([
        {
            path: 'artifactItems/p/artifacts/a',
            data: expect.objectContaining({ isPrivate: true, isPublicFor: ['owner'] }),
        },
    ])
})

it('changes the chat assistant on the artifact and its chat in one commit, without an edition stamp', async () => {
    await setArtifactAssistant('p', 'a', 'assistant-2')
    expect(updateChatAssistantWithoutFeeds).toHaveBeenCalledWith('p', 'a', 'assistant-2', expect.anything())
    expect(commits).toEqual([
        [
            { path: 'artifactItems/p/artifacts/a', data: { assistantId: 'assistant-2' } },
            { path: 'chatObjects/p/chats/a', data: { assistantId: 'assistant-2' } },
        ],
    ])
})

it('keeps and repairs the last-comment preview', async () => {
    await updateArtifactLastCommentData('p', 'a', 'Looks good', 'comment')
    expect(writes).toEqual([
        {
            path: 'artifactItems/p/artifacts/a',
            data: {
                'commentsData.lastComment': 'Looks good',
                'commentsData.lastCommentType': 'comment',
                'commentsData.amount': { increment: 1 },
            },
        },
    ])

    writes = []
    docs.set('artifactItems/p/artifacts/a', { title: 'A', commentsData: { amount: 0 } })
    await resetArtifactLastCommentData('p', 'a')
    expect(writes).toEqual([])

    docs.set('artifactItems/p/artifacts/a', { title: 'A', commentsData: { amount: 3, lastComment: 'x' } })
    await resetArtifactLastCommentData('p', 'a')
    expect(writes).toEqual([
        {
            path: 'artifactItems/p/artifacts/a',
            data: { 'commentsData.lastComment': null, 'commentsData.lastCommentType': null, 'commentsData.amount': 0 },
        },
    ])
})

it('watches the tasks and notes that link to the artifact through the per-reader backlink tokens', () => {
    const listeners = {}
    const queries = []
    const unsubscribed = []
    getDb.mockReturnValue({
        collection: path => ({
            where: (field, op, value) => {
                queries.push({ path, field: field.segments, op, value })
                return {
                    onSnapshot: next => {
                        listeners[path] = next
                        return () => unsubscribed.push(path)
                    },
                }
            },
        }),
    })
    const onChange = jest.fn()
    const unsubscribe = watchArtifactBacklinks('p', 'a', onChange)

    const token = JSON.stringify(['linkedParentArtifactsIds', 'a'])
    expect(queries).toEqual([
        { path: 'items/p/tasks', field: ['backlinkIdsVisibleTo', 'u'], op: 'array-contains', value: token },
        { path: 'noteItems/p/notes', field: ['backlinkIdsVisibleTo', 'u'], op: 'array-contains', value: token },
    ])

    const snapshot = docs => ({ docs: docs.map(([id, data]) => ({ id, data: () => data })) })
    listeners['items/p/tasks'](snapshot([['t1', { extendedName: 'Check it', done: true, lastEditionDate: 1 }]]))
    listeners['noteItems/p/notes'](snapshot([['n1', { extendedTitle: 'Review', lastEditionDate: 5 }]]))
    expect(onChange).toHaveBeenLastCalledWith([
        { type: 'note', id: 'n1', title: 'Review', done: false, lastEditionDate: 5 },
        { type: 'task', id: 't1', title: 'Check it', done: true, lastEditionDate: 1 },
    ])

    unsubscribe()
    expect(unsubscribed).toEqual(['items/p/tasks', 'noteItems/p/notes'])
})
