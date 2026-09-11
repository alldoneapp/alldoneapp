jest.mock('firebase-admin', () => {
    let docs = new Map()
    let failUserUpdate = false
    const clone = value => JSON.parse(JSON.stringify(value))
    const applyWrite = (path, data, merge = false) => {
        const next = merge ? { ...(docs.get(path) || {}) } : {}
        Object.entries(data).forEach(([key, value]) => {
            next[key] =
                value && typeof value.__increment === 'number' ? (Number(next[key]) || 0) + value.__increment : value
        })
        docs.set(path, next)
    }
    const doc = path => ({
        path,
        collection: name => ({ doc: id => doc(`${path}/${name}/${id}`) }),
        get: async () => ({ exists: docs.has(path), data: () => clone(docs.get(path) || {}) }),
        set: (data, options) => applyWrite(path, data, options?.merge),
        update: data => {
            if (failUserUpdate && path.startsWith('users/')) throw new Error('simulated user update failure')
            applyWrite(path, data, true)
        },
        delete: () => docs.delete(path),
    })
    const firestore = jest.fn(() => ({
        doc,
        runTransaction: async callback =>
            callback({
                get: async ref => ({ exists: docs.has(ref.path), data: () => clone(docs.get(ref.path) || {}) }),
                set: (ref, data, options) => applyWrite(ref.path, data, options?.merge),
                update: (ref, data) => applyWrite(ref.path, data, true),
                delete: ref => docs.delete(ref.path),
            }),
    }))
    firestore.FieldValue = { increment: value => ({ __increment: value }) }
    firestore.Timestamp = { now: () => 'TIMESTAMP' }
    return {
        firestore,
        __mock: {
            reset: () => {
                docs = new Map()
                failUserUpdate = false
            },
            set: (path, data) => docs.set(path, clone(data)),
            get: path => docs.get(path),
            list: prefix => Array.from(docs.entries()).filter(([path]) => path.startsWith(prefix)),
            failUserUpdate: () => {
                failUserUpdate = true
            },
        },
    }
})

jest.mock('../Utils/HelperFunctionsCloud', () => ({ STAYWARD_COMMENT: 'STAYWARD_COMMENT' }))

const admin = require('firebase-admin')
const { storeCallTranscriptTurn } = require('./whatsAppCallTranscript')

const TURN = {
    sessionId: 'session-1',
    projectId: 'project-1',
    chatId: 'chat-1',
    userId: 'user-1',
    assistantId: 'assistant-1',
}

const LAST_COMMENT_PROJECT_KEY = 'lastAssistantCommentData.project-1'
const LAST_COMMENT_ALL_PROJECTS_KEY = 'lastAssistantCommentData.allProjects'

describe('storeCallTranscriptTurn -> lastAssistantCommentData (AssistantLine pointer)', () => {
    beforeEach(() => {
        admin.__mock.reset()
        admin.__mock.set('users/user-1', {})
        admin.__mock.set('chatObjects/project-1/chats/chat-1', { commentsData: { amount: 0 } })
    })

    test('an assistant turn points the AssistantLine "Last comment" bubble at the daily topic', async () => {
        const result = await storeCallTranscriptTurn({ ...TURN, turnId: 'a1', role: 'assistant', text: 'Hi there.' })
        expect(result.stored).toBe(true)

        const userDoc = admin.__mock.get('users/user-1')
        expect(userDoc[LAST_COMMENT_PROJECT_KEY]).toEqual({
            objectType: 'topics',
            objectId: 'chat-1',
            creatorId: 'assistant-1',
            creatorType: 'user',
            date: expect.any(Number),
        })
        expect(userDoc[LAST_COMMENT_ALL_PROJECTS_KEY]).toEqual(
            expect.objectContaining({ objectType: 'topics', objectId: 'chat-1', projectId: 'project-1' })
        )
    })

    test('the recap turn moves the pointer to the daily topic', async () => {
        const result = await storeCallTranscriptTurn({
            ...TURN,
            turnId: 'post_call_recap',
            role: 'assistant',
            text: 'Call recap: A task was created.',
        })
        expect(result.stored).toBe(true)
        expect(admin.__mock.get('users/user-1')[LAST_COMMENT_PROJECT_KEY]).toEqual(
            expect.objectContaining({ objectId: 'chat-1' })
        )
    })

    test('a caller (user) turn does not move the assistant pointer', async () => {
        await storeCallTranscriptTurn({ ...TURN, turnId: 'u1', role: 'user', text: 'Create a task.' })

        const userDoc = admin.__mock.get('users/user-1')
        expect(userDoc[LAST_COMMENT_PROJECT_KEY]).toBeUndefined()
        expect(userDoc[LAST_COMMENT_ALL_PROJECTS_KEY]).toBeUndefined()
    })

    test('an idempotent re-store of the same assistant turn does not throw and keeps the comment count at one', async () => {
        const first = await storeCallTranscriptTurn({ ...TURN, turnId: 'a1', role: 'assistant', text: 'Done.' })
        const second = await storeCallTranscriptTurn({ ...TURN, turnId: 'a1', role: 'assistant', text: 'Done.' })

        expect(first.stored).toBe(true)
        expect(second.stored).toBe(false)
        expect(admin.__mock.list('chatComments/project-1/topics/chat-1/comments/')).toHaveLength(1)
        expect(admin.__mock.get('users/user-1')[LAST_COMMENT_PROJECT_KEY]).toEqual(
            expect.objectContaining({ objectId: 'chat-1' })
        )
    })

    test('a failing user-doc update is best-effort and never fails transcript storage', async () => {
        admin.__mock.failUserUpdate()

        const result = await storeCallTranscriptTurn({ ...TURN, turnId: 'a1', role: 'assistant', text: 'Hello.' })

        expect(result.stored).toBe(true)
        expect(admin.__mock.list('chatComments/project-1/topics/chat-1/comments/')).toHaveLength(1)
        expect(admin.__mock.get('users/user-1')[LAST_COMMENT_PROJECT_KEY]).toBeUndefined()
    })
})
