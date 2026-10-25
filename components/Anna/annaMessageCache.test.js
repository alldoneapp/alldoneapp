import { createAnnaMessageCache } from './annaMessageCache'

jest.mock('../../utils/appResume', () => ({ subscribePageHidden: () => () => {} }))
const scope = { userId: 'u1', projectId: 'p1', objectId: 'AnnaChat20261012u1', chatType: 'topics', limit: 50 }
const messages = Array.from({ length: 60 }, (_, index) => ({
    id: `m${index}`,
    created: index,
    commentText: `Message ${index}`,
}))
beforeEach(() => localStorage.clear())

it('restores the latest 50 messages synchronously after a fresh cache instance', () => {
    const cache = createAnnaMessageCache()
    cache.write(scope, messages)
    cache.flush()
    const reopened = createAnnaMessageCache()
    expect(reopened.read(scope)).toEqual(messages.slice(-50))
    expect(reopened.read({ ...scope, limit: 10 })).toEqual(messages.slice(-10))
    expect(reopened.read({ ...scope, userId: 'u2' })).toBeNull()
    expect(reopened.read({ ...scope, projectId: 'p2' })).toBeNull()
    expect(reopened.read({ ...scope, chatType: 'tasks' })).toBeNull()
})

it('replaces saved messages after server edits/deletions and removes revoked chats', () => {
    const cache = createAnnaMessageCache()
    cache.write(scope, messages)
    cache.write(scope, [])
    cache.flush()
    expect(createAnnaMessageCache().read(scope)).toEqual([])
    cache.remove(scope)
    expect(createAnnaMessageCache().read(scope)).toBeNull()
})

it('bounds the number and size of saved threads without truncating message text', () => {
    const cache = createAnnaMessageCache()
    for (let day = 1; day <= 9; day++) cache.write({ ...scope, objectId: `AnnaChat2026100${day}u1` }, messages)
    cache.flush()
    expect(Object.keys(JSON.parse(localStorage.getItem('alldone.annaMessages.v1:u1')).threads)).toHaveLength(6)
    expect(createAnnaMessageCache().read({ ...scope, objectId: 'AnnaChat20261009u1' })).toEqual(messages.slice(-50))
    expect(createAnnaMessageCache().read({ ...scope, objectId: 'AnnaChat20261001u1' })).toBeNull()
    cache.write(scope, [{ id: 'large', commentText: 'a'.repeat(1024 * 1024 + 1) }])
    cache.flush()
    expect(localStorage.getItem('alldone.annaMessages.v1:u1').length).toBeLessThanOrEqual(1024 * 1024)
    expect(createAnnaMessageCache().read(scope)).toBeNull()
})

it('tolerates corrupt or unavailable storage', () => {
    localStorage.setItem('alldone.annaMessages.v1:u1', '{broken')
    expect(createAnnaMessageCache().read(scope)).toBeNull()
    const cache = createAnnaMessageCache(() => {
        throw new Error('Storage unavailable')
    })
    expect(cache.read(scope)).toBeNull()
    expect(() => {
        cache.write(scope, messages)
        cache.flush()
    }).not.toThrow()
})
