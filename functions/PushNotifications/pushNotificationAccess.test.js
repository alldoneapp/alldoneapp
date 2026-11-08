'use strict'

// Security audit 2026-11: sendPushNotificationSecondGen delivered a client-composed FCM + WhatsApp
// notification to any user ids, and its WhatsApp path looked up foreign project/chat names and
// deleted chat notifications by a caller-chosen id.

const { createFirestoreDouble } = require('../Assistant/__securityFirestoreDouble')
const { resolvePushNotificationRequest } = require('./pushNotificationAccess')

function seed() {
    return createFirestoreDouble({
        'users/member': { displayName: 'Mia Member' },
        'users/colleague': { displayName: 'Carl Colleague' },
        'users/outsider': {},
        'projects/p1': { name: 'Apollo', userIds: ['member', 'colleague', 'quiet'] },
        'projects/p2': { name: 'Secret project', userIds: ['outsider'] },
        'items/p1/tasks/t1': { name: 'Ship it', isPublicFor: [0] },
        'items/p1/tasks/private': { name: 'Private', isPublicFor: ['colleague'] },
        'followers/p1/tasks/t1': { usersFollowing: ['colleague', 'member'] },
        'followers/p1/tasks/private': { usersFollowing: ['colleague'] },
        'followers/p1/users/colleague': { usersFollowing: ['member'] },
        'followers/p1/projects/p1': { usersFollowing: ['colleague'] },
    })
}

const request = (uid, data) => ({ auth: uid ? { uid } : null, data })

describe('resolvePushNotificationRequest', () => {
    test('delivers a task update to followers only, with names, link and type from stored data', async () => {
        const notification = await resolvePushNotificationRequest(
            seed(),
            request('member', {
                projectId: 'p1',
                objectType: 'tasks',
                objectId: 't1',
                userIds: ['colleague', 'quiet', 'outsider'],
                type: 'Forged',
                body: 'Your bank\n  ✔ Reset your password\n Mia changed assignee • From Mia To Carl',
                link: 'https://my.alldone.app/phishing',
                chatId: 'secretChat',
                id: 'someone-elses-comment',
                initiatorVia: 'mcp',
            })
        )
        expect(notification).toEqual({
            type: 'Updates Notification',
            body: 'Apollo\n  ✔ Ship it\n Mia changed assignee • From Mia To Carl',
            link: 'https://my.alldone.app/projects/p1/tasks/t1/properties',
            userIds: ['colleague'],
            projectId: 'p1',
            initiatorId: 'member',
        })
    })

    test('rejects a caller who is not a member of the project', async () => {
        await expect(
            resolvePushNotificationRequest(
                seed(),
                request('outsider', { projectId: 'p1', objectType: 'tasks', objectId: 't1', userIds: ['colleague'] })
            )
        ).rejects.toMatchObject({ code: 'permission-denied' })
    })

    test('rejects a task the caller cannot read', async () => {
        await expect(
            resolvePushNotificationRequest(
                seed(),
                request('member', { projectId: 'p1', objectType: 'tasks', objectId: 'private', userIds: ['colleague'] })
            )
        ).rejects.toMatchObject({ code: 'permission-denied' })
    })

    test('rejects a request that names no object, like the old free-form payload', async () => {
        await expect(
            resolvePushNotificationRequest(
                seed(),
                request('member', { userIds: ['colleague'], body: 'hi', link: 'https://evil.test', type: 'x' })
            )
        ).rejects.toMatchObject({ code: 'invalid-argument' })
    })

    test('a member profile update uses the member name from their user document', async () => {
        const notification = await resolvePushNotificationRequest(
            seed(),
            request('colleague', {
                projectId: 'p1',
                objectType: 'users',
                objectId: 'colleague',
                userIds: ['member'],
                body: 'Apollo\n  👤 Somebody Else\n Carl started following all Apollo project members',
                link: 'https://evil.test/x',
            })
        )
        expect(notification.body).toBe('Apollo\n  👤 Carl\n Carl started following all Apollo project members')
        expect(notification.link).toBe('https://my.alldone.app/projects/p1/contacts/colleague/profile')
        expect(notification.userIds).toEqual(['member'])
    })

    test('a project update must name the project itself', async () => {
        await expect(
            resolvePushNotificationRequest(
                seed(),
                request('member', { projectId: 'p1', objectType: 'projects', objectId: 'p2', userIds: ['colleague'] })
            )
        ).rejects.toMatchObject({ code: 'invalid-argument' })
    })
})
