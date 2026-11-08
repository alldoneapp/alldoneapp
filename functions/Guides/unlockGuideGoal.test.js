'use strict'

// AT-2978 (security decision 2): a locked guide goal is unlocked by the server, which charges the
// 80 Gold and stores the lock key in one transaction. Key and owner come from the stored goal.

jest.mock('firebase-admin', () => ({}))
jest.mock('firebase-admin/firestore', () => ({
    FieldValue: {
        serverTimestamp: () => 'TS',
        arrayUnion: (...values) => ({ __arrayUnion: values }),
    },
}))

const fs = require('fs')
const path = require('path')
const { unlockGuideGoal, GOAL_UNLOCK_GOLD } = require('./unlockGuideGoal')

function applyValue(previous, value) {
    if (value && value.__arrayUnion) {
        const list = Array.isArray(previous) ? [...previous] : []
        value.__arrayUnion.forEach(item => {
            if (!list.includes(item)) list.push(item)
        })
        return list
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const base = previous && typeof previous === 'object' && !Array.isArray(previous) ? { ...previous } : {}
        Object.entries(value).forEach(([key, nested]) => {
            base[key] = applyValue(base[key], nested)
        })
        return base
    }
    return value
}

function createDb(seed) {
    const docs = new Map(Object.entries(seed))
    let autoId = 0
    const snapshot = p => ({ exists: docs.has(p), data: () => (docs.has(p) ? { ...docs.get(p) } : undefined) })
    const ref = p => ({
        path: p,
        get: async () => snapshot(p),
        collection: name => ({ doc: id => ref(`${p}/${name}/${id || `auto${++autoId}`}`) }),
    })
    return {
        docs,
        doc: ref,
        runTransaction: async fn => {
            const writes = []
            await fn({
                get: async r => snapshot(r.path),
                set: (r, data, options) => writes.push({ path: r.path, data, merge: !!options?.merge }),
            })
            writes.forEach(({ path: p, data, merge }) => {
                docs.set(p, merge ? applyValue(docs.get(p) || {}, data) : applyValue({}, data))
            })
        },
    }
}

const seed = extra => ({
    'projects/guide': { userIds: ['member', 'creator', 'owner'] },
    'goals/guide/items/g1': { lockKey: 'key-1', ownerId: 'owner' },
    'goals/guide/items/open': { ownerId: 'owner' },
    'users/member': { gold: 100 },
    'users/creator': { gold: 100, realTemplateProjectIds: ['guide'] },
    'users/owner': { gold: 5 },
    'users/poor': { gold: 10 },
    'roles/administrator': { userId: 'admin' },
    ...extra,
})

const keys = (db, uid) => db.docs.get(`users/${uid}`).unlockedKeysByGuides?.guide || []
const ledger = (db, uid) =>
    [...db.docs.entries()].filter(([p]) => p.startsWith(`users/${uid}/goldTransactions/`)).map(([, d]) => d)

test('a member pays 80 Gold and gets the key from the stored goal, in one transaction', async () => {
    const db = createDb(seed())
    const result = await unlockGuideGoal({ db, callerId: 'member', projectId: 'guide', goalId: 'g1' })

    expect(result).toMatchObject({ success: true, newBalance: 100 - GOAL_UNLOCK_GOLD, unlockedFor: 'member' })
    expect(keys(db, 'member')).toEqual(['key-1'])
    expect(ledger(db, 'member')).toEqual([
        expect.objectContaining({ direction: 'spend', source: 'goal_unlock', amount: GOAL_UNLOCK_GOLD }),
    ])
})

test('unlocking again charges nothing', async () => {
    const db = createDb(seed({ 'users/member': { gold: 100, unlockedKeysByGuides: { guide: ['key-1'] } } }))
    const result = await unlockGuideGoal({ db, callerId: 'member', projectId: 'guide', goalId: 'g1' })
    expect(result).toMatchObject({ success: true, alreadyUnlocked: true })
    expect(db.docs.get('users/member').gold).toBe(100)
    expect(ledger(db, 'member')).toEqual([])
})

test('without enough Gold nothing is charged and no key is stored', async () => {
    const db = createDb(seed({ 'projects/guide': { userIds: ['poor'] } }))
    const result = await unlockGuideGoal({ db, callerId: 'poor', projectId: 'guide', goalId: 'g1' })
    expect(result).toMatchObject({ success: false })
    expect(db.docs.get('users/poor')).toEqual({ gold: 10 })
})

test('the guide creator pays and unlocks for the goal owner', async () => {
    const db = createDb(seed())
    const result = await unlockGuideGoal({ db, callerId: 'creator', projectId: 'guide', goalId: 'g1' })
    expect(result).toMatchObject({ success: true, unlockedFor: 'owner' })
    expect(keys(db, 'owner')).toEqual(['key-1'])
    expect(db.docs.get('users/creator').gold).toBe(100 - GOAL_UNLOCK_GOLD)
    expect(db.docs.get('users/owner').gold).toBe(5)
})

test('the administrator counts as the creator', async () => {
    const db = createDb(seed({ 'projects/guide': { userIds: ['admin', 'owner'] }, 'users/admin': { gold: 200 } }))
    const result = await unlockGuideGoal({ db, callerId: 'admin', projectId: 'guide', goalId: 'g1' })
    expect(result).toMatchObject({ success: true, unlockedFor: 'owner' })
})

test('a goal without a lock key needs no unlock', async () => {
    const db = createDb(seed())
    expect(await unlockGuideGoal({ db, callerId: 'member', projectId: 'guide', goalId: 'open' })).toMatchObject({
        success: true,
        notLocked: true,
    })
    expect(db.docs.get('users/member').gold).toBe(100)
})

test.each([
    ['a non-member', { callerId: 'stranger' }, 'permission-denied'],
    ['a missing goal', { goalId: 'gone' }, 'not-found'],
    ['an id that is a path', { goalId: '../x' }, 'invalid-argument'],
    ['no caller', { callerId: '' }, 'unauthenticated'],
])('refuses %s', async (_, overrides, code) => {
    const db = createDb(seed())
    await expect(
        unlockGuideGoal({ db, callerId: 'member', projectId: 'guide', goalId: 'g1', ...overrides })
    ).rejects.toMatchObject({ code })
})

test('the server price matches UNLOCK_GOAL_COST in the app, and the app calls the server', () => {
    const repoRoot = path.join(__dirname, '..', '..')
    const helper = fs.readFileSync(path.join(repoRoot, 'components', 'Guides', 'guidesHelper.js'), 'utf8')
    expect(helper).toMatch(new RegExp(`UNLOCK_GOAL_COST = ${GOAL_UNLOCK_GOLD}\\b`))
    const users = fs.readFileSync(path.join(repoRoot, 'utils', 'backends', 'Users', 'usersFirestore.js'), 'utf8')
    expect(users).toContain("runHttpsCallableFunction('unlockGuideGoalSecondGen'")
    expect(users).not.toMatch(/unlockedKeysByGuides\.\$\{projectId\}`\]: firebase\.firestore\.FieldValue\.arrayUnion/)
})
