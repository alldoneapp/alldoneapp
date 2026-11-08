'use strict'

// Security audit 2026-11 (high): onCopyProjectSecondGen copied any project id as whichever `user`
// the request named, so a signed-in non-member could duplicate a Private project into a project
// of their own, or make a third user the owner of the copy.

const fs = require('fs')
const path = require('path')
const { createFirestoreDouble } = require('../Assistant/__securityFirestoreDouble')
const { resolveCopyProjectRequest } = require('./copyProjectAccess')

function seed() {
    return createFirestoreDouble({
        'users/member': { displayName: 'Mia Member', email: 'mia@example.test' },
        'users/outsider': { displayName: 'Otto Outsider', email: 'otto@example.test' },
        'projects/p1': { userIds: ['member'], isShared: 2 },
    })
}

const request = (uid, data) => ({ auth: uid ? { uid } : null, data })

describe('resolveCopyProjectRequest', () => {
    test('rejects an unauthenticated call', async () => {
        await expect(resolveCopyProjectRequest(seed(), request(null, { projectId: 'p1' }))).rejects.toMatchObject({
            code: 'unauthenticated',
        })
    })

    test('refuses a caller who is not a member of the source project', async () => {
        const db = seed()
        await expect(
            resolveCopyProjectRequest(
                db,
                request('outsider', { projectId: 'p1', user: { uid: 'outsider' }, options: ['PROJECT_NOTES'] })
            )
        ).rejects.toMatchObject({ code: 'permission-denied' })
        expect(db.writes).toEqual([])
    })

    test('a member copies as themselves, whatever user the request names', async () => {
        const resolved = await resolveCopyProjectRequest(
            seed(),
            request('member', {
                projectId: 'p1',
                user: { uid: 'bystander', email: 'attacker@example.test' },
                options: ['PROJECT_TASKS', 'PROJECT_NOTES', 'PROJECT_TASKS', 'bogus', 7],
            })
        )
        expect(resolved.projectId).toBe('p1')
        expect(resolved.user.uid).toBe('member')
        expect(resolved.user.email).toBe('mia@example.test')
        expect(resolved.options).toEqual(['PROJECT_TASKS', 'PROJECT_NOTES'])
    })

    test('rejects a missing project id', async () => {
        await expect(resolveCopyProjectRequest(seed(), request('member', {}))).rejects.toMatchObject({
            code: 'invalid-argument',
        })
    })
})

describe('onCopyProjectSecondGen wiring', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')
    const start = source.indexOf('exports.onCopyProjectSecondGen')
    const handler = source.slice(start, source.indexOf('exports.', start + 10))

    test('resolves project, owner and options through copyProjectAccess', () => {
        expect(handler).toMatch(/resolveCopyProjectRequest\(admin\.firestore\(\), request\)/)
        expect(handler).not.toMatch(/=\s*data\b/)
        expect(handler).not.toMatch(/request\.data/)
    })
})
