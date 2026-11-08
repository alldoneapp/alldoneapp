'use strict'

// Security audit 2026-11: generateAssistantDelegationDescriptionSecondGen used the READ gate for
// global assistants and then wrote the global catalog entry with the Admin SDK.

const { createFirestoreDouble } = require('./__securityFirestoreDouble')
const { assertAssistantProjectAccess } = require('./assistantProjectAccess')

function seed() {
    const db = createFirestoreDouble({
        'users/member': {},
        'users/admin': {},
        'users/outsider': {},
        'roles/administrator': { userId: 'admin' },
        'projects/p1': { userIds: ['member'], globalAssistantIds: ['g1'] },
        'projects/p2': { userIds: ['outsider'] },
        'assistants/globalProject/items/g1': { displayName: 'Global' },
        'assistants/p1/items/a1': { displayName: 'Local' },
    })
    // Just enough of where('userIds', 'array-contains', uid) for the membership scan.
    const docCollection = db.collection
    db.collection = name => ({
        ...docCollection(name),
        where: (field, op, value) => ({
            get: async () => ({
                docs: [...db.store.entries()]
                    .filter(([path, data]) => {
                        const parts = path.split('/')
                        return parts.length === 2 && parts[0] === name && (data[field] || []).includes(value)
                    })
                    .map(([path, data]) => ({ id: path.split('/')[1], data: () => ({ ...data }) })),
            }),
        }),
    })
    return db
}

describe('assertAssistantProjectAccess', () => {
    test('a member of a project listing a global assistant may read it', async () => {
        await expect(assertAssistantProjectAccess(seed(), 'member', 'globalProject', 'g1')).resolves.toBeUndefined()
    })

    test('a member may NOT change a global catalog assistant', async () => {
        await expect(
            assertAssistantProjectAccess(seed(), 'member', 'globalProject', 'g1', { forWrite: true })
        ).rejects.toMatchObject({ code: 'permission-denied' })
    })

    test('the administrator may change a global catalog assistant', async () => {
        await expect(
            assertAssistantProjectAccess(seed(), 'admin', 'globalProject', 'g1', { forWrite: true })
        ).resolves.toBeUndefined()
    })

    test('a user whose projects do not list the global assistant cannot read it', async () => {
        await expect(assertAssistantProjectAccess(seed(), 'outsider', 'globalProject', 'g1')).rejects.toMatchObject({
            code: 'permission-denied',
        })
    })

    test('project assistants follow project membership for reads and writes', async () => {
        await expect(
            assertAssistantProjectAccess(seed(), 'member', 'p1', 'a1', { forWrite: true })
        ).resolves.toBeUndefined()
        await expect(
            assertAssistantProjectAccess(seed(), 'outsider', 'p1', 'a1', { forWrite: true })
        ).rejects.toMatchObject({ code: 'permission-denied' })
    })
})
