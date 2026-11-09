'use strict'

const { reindexUnlockedGoalForUser } = require('./unlockGoalReindex')

const makeDb = docs => ({
    doc: path => ({ get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }) }),
})

describe('re-indexing an unlocked goal (security audit 2026-11, #16)', () => {
    const docs = new Map([
        ['projects/p1', { userIds: ['member'] }],
        ['goals/p1/items/g1', { name: 'Goal' }],
    ])

    test('re-indexes for a project member', async () => {
        const reindex = jest.fn()
        await expect(
            reindexUnlockedGoalForUser({ db: makeDb(docs), userId: 'member', projectId: 'p1', goalId: 'g1', reindex })
        ).resolves.toEqual({ success: true })
        expect(reindex).toHaveBeenCalledWith('p1', 'g1')
    })

    test('refuses an outsider, a missing goal and a malformed id without touching the index', async () => {
        const reindex = jest.fn()
        const db = makeDb(docs)
        await expect(
            reindexUnlockedGoalForUser({ db, userId: 'outsider', projectId: 'p1', goalId: 'g1', reindex })
        ).rejects.toMatchObject({ code: 'permission-denied' })
        await expect(
            reindexUnlockedGoalForUser({ db, userId: 'member', projectId: 'p1', goalId: 'gone', reindex })
        ).rejects.toMatchObject({ code: 'not-found' })
        await expect(
            reindexUnlockedGoalForUser({ db, userId: 'member', projectId: 'p1/x', goalId: 'g1', reindex })
        ).rejects.toMatchObject({ code: 'invalid-argument' })
        expect(reindex).not.toHaveBeenCalled()
    })
})

test('the callable goes through the membership check', () => {
    const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.js'), 'utf8')
    const start = source.indexOf('exports.proccessAlgoliaRecordsWhenUnlockGoalSecondGen')
    const block = source.slice(start, source.indexOf('\nexports.', start + 1))
    expect(block).toMatch(/reindexUnlockedGoalForUser\(/)
    expect(block).not.toMatch(/^\s*await proccessAlgoliaRecordsWhenUnlockGoal\(/m)
})
