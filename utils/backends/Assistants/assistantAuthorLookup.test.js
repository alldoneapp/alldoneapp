import { getDb } from '../firestore'
import { findAssistantAuthor } from './assistantAuthorLookup'

jest.mock('../firestore', () => ({ getDb: jest.fn() }))

let read
beforeEach(() => {
    read = jest.fn(async () => ({ exists: false }))
    getDb.mockReturnValue({ doc: path => ({ get: () => read(path) }) })
})

it('resolves a delegated author in an accessible project without listing assistant collections', async () => {
    read.mockImplementation(async path => ({
        exists: path === 'assistants/team/items/cto',
        data: () => ({ displayName: 'Team CTO' }),
    }))
    await expect(findAssistantAuthor('cto', ['private', 'team'], 'user')).resolves.toEqual({
        uid: 'cto',
        displayName: 'Team CTO',
    })
    expect(read.mock.calls.map(([path]) => path)).toEqual([
        'assistants/globalProject/items/cto',
        'assistants/private/items/cto',
        'assistants/team/items/cto',
    ])
})

it('shares simultaneous lookups, but does not cache misses across retries or sessions', async () => {
    const first = findAssistantAuthor('cto', ['team'], 'user')
    const second = findAssistantAuthor('cto', ['team'], 'user')
    expect(second).toBe(first)
    await first
    expect(read).toHaveBeenCalledTimes(2)
    await findAssistantAuthor('cto', ['team'], 'user')
    expect(read).toHaveBeenCalledTimes(4)
    const other = findAssistantAuthor('cto', ['team'], 'other-user')
    expect(other).not.toBe(first)
    await other
})

it('ignores a denied or removed project without losing a valid result from another', async () => {
    read.mockImplementation(async path => {
        if (path.includes('/removed/')) throw Object.assign(new Error('Denied'), { code: 'permission-denied' })
        return { exists: path.includes('/team/'), data: () => ({ displayName: 'CTO' }) }
    })
    await expect(findAssistantAuthor('cto', ['removed', 'team'], 'user')).resolves.toMatchObject({ displayName: 'CTO' })
})

it('does not read private profiles without an authenticated user', async () => {
    await expect(findAssistantAuthor('cto', ['team'], '')).resolves.toBeNull()
    expect(read).not.toHaveBeenCalled()
})
