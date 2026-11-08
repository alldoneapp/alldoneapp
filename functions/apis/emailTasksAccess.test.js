'use strict'

// Security audit 2026-11: createApiEmailTasksSecondGen wrote the "Emails in inbox" task of any user
// in any project, with a caller-chosen address and count.

const { createFirestoreDouble } = require('../Assistant/__securityFirestoreDouble')
const { resolveApiEmailTaskRequest } = require('./emailTasksAccess')

function seed() {
    return createFirestoreDouble({
        'users/member': {
            email: 'member@example.com',
            apisConnected: { p1: { gmail: true, gmailEmail: 'Member.Work@example.com' }, p2: { gmail: false } },
        },
        'users/victim': { apisConnected: { p1: { gmail: true } } },
        'users/outsider': { apisConnected: { p1: { gmail: true } } },
        'projects/p1': { userIds: ['member', 'victim'] },
        'projects/p2': { userIds: ['member'] },
    })
}

const request = (uid, data) => ({ auth: uid ? { uid } : null, data })
const validData = overrides => ({
    projectId: 'p1',
    date: 1700000000000,
    unreadMails: 12,
    timezone: 1,
    ...overrides,
})

describe('resolveApiEmailTaskRequest', () => {
    test("writes the caller's own task, never the user named in the request", async () => {
        const resolved = await resolveApiEmailTaskRequest(seed(), request('member', validData({ uid: 'victim' })))
        expect(resolved).toMatchObject({ uid: 'member', projectId: 'p1', unreadMails: 12, provider: 'google' })
    })

    test('rejects a caller who is not a member of the project', async () => {
        await expect(resolveApiEmailTaskRequest(seed(), request('outsider', validData()))).rejects.toMatchObject({
            code: 'permission-denied',
        })
    })

    test('rejects a project without a connected mailbox', async () => {
        await expect(
            resolveApiEmailTaskRequest(seed(), request('member', validData({ projectId: 'p2' })))
        ).rejects.toMatchObject({ code: 'failed-precondition' })
    })

    test('keeps a requested address only when it is stored on the connection', async () => {
        const own = await resolveApiEmailTaskRequest(
            seed(),
            request('member', validData({ email: 'member.work@example.com' }))
        )
        expect(own.email).toBe('Member.Work@example.com')

        const forged = await resolveApiEmailTaskRequest(
            seed(),
            request('member', validData({ email: 'ceo@victim.example' }))
        )
        expect(forged.email).toBe('Member.Work@example.com')
    })

    test('ignores the requested provider and validates the count', async () => {
        const resolved = await resolveApiEmailTaskRequest(seed(), request('member', validData({ provider: 'evil' })))
        expect(resolved.provider).toBe('google')
        await expect(
            resolveApiEmailTaskRequest(seed(), request('member', validData({ unreadMails: '<b>9</b>' })))
        ).rejects.toMatchObject({ code: 'invalid-argument' })
    })
})
