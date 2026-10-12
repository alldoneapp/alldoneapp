import {
    clearAnnaConversationCache,
    readAnnaConversationCache,
    saveAnnaConversationCache,
} from './annaConversationCache'

const user = { defaultProjectId: 'p1', projectIds: ['p1', 'p2'] }
const conversation = {
    id: 'AnnaChat20261011u1',
    projectId: 'p1',
    assistantId: 'a1',
    annaOwnerId: 'u1',
    creatorId: 'u1',
    type: 'topics',
    created: 11,
    annaDateKey: '20261011',
    annaPresentation: { id: 'old-action' },
    annaPageContext: { title: 'Private page' },
}
const threads = Array.from({ length: 10 }, (_, index) => ({
    projectId: 'p1',
    chatId: `AnnaChat202610${String(index + 2).padStart(2, '0')}u1`,
    created: index + 2,
    dateKey: `202610${String(index + 2).padStart(2, '0')}`,
}))
const save = (overrides = {}) =>
    saveAnnaConversationCache('u1', 'p1', { conversation, threads, nextBefore: null, ...overrides })
beforeEach(() => localStorage.clear())
afterEach(() => jest.restoreAllMocks())

it('bounds the saved index and preserves a cursor for history outside that window', () => {
    save()
    const restored = readAnnaConversationCache('u1', user)
    expect(restored.threads).toEqual(threads.slice(-3))
    expect(restored.nextBefore).toEqual({ created: 9, id: 'p1__AnnaChat20261009u1' })
    expect(restored.conversation.id).toBe(conversation.id)
    expect(restored.conversation.annaPresentation).toBeUndefined()
    expect(restored.conversation.annaPageContext).toBeUndefined()
})

it('trims a previous seven-thread cache without skipping the removed history', () => {
    save()
    const key = localStorage.key(0)
    const cached = JSON.parse(localStorage.getItem(key))
    localStorage.setItem(
        key,
        JSON.stringify({
            ...cached,
            threads: threads.slice(-7),
            nextBefore: { created: 5, id: 'p1__AnnaChat20261005u1' },
        })
    )
    const restored = readAnnaConversationCache('u1', user)
    expect(restored.threads).toEqual(threads.slice(-3))
    expect(restored.nextBefore).toEqual({ created: 9, id: 'p1__AnnaChat20261009u1' })
})

it('isolates accounts and default projects and filters history for lost project access', () => {
    save({ threads: [...threads, { projectId: 'p2', chatId: 'anna_u1', created: 12 }] })
    expect(readAnnaConversationCache('u2', user)).toBeNull()
    expect(readAnnaConversationCache('u1', { defaultProjectId: 'p2' })).toBeNull()
    expect(readAnnaConversationCache('u1', { ...user, isAnonymous: true })).toBeNull()
    expect(
        readAnnaConversationCache('u1', { defaultProjectId: 'p1' }).threads.every(thread => thread.projectId === 'p1')
    ).toBe(true)
    clearAnnaConversationCache('u1', 'p1')
    expect(readAnnaConversationCache('u1', user)).toBeNull()
})

it('ignores corrupt or unavailable storage without breaking normal chat startup', () => {
    save()
    localStorage.setItem(localStorage.key(0), '{broken')
    expect(readAnnaConversationCache('u1', user)).toBeNull()
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('Storage unavailable')
    })
    expect(() => save()).not.toThrow()
    expect(readAnnaConversationCache('u1', user)).toBeNull()
})
