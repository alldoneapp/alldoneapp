'use strict'

// Security audit 2026-11: sendUserJoinsToGuideEmailSecondGen mailed any user's account email to any
// recipients the caller named, inside unescaped Alldone-branded HTML.

const { createFirestoreDouble } = require('../Assistant/__securityFirestoreDouble')
const { resolveGuideJoinEmailRequest, buildNewUserJoinedGuideHtml } = require('./guideJoinEmail')

function seed() {
    return createFirestoreDouble({
        'users/joiner': {},
        'users/outsider': {},
        'roles/administrator': { userId: 'admin' },
        'projects/template1': { templateCreatorId: 'creator', isTemplate: true },
        'projects/guide1': { userIds: ['joiner', 'creator', 'admin'], parentTemplateId: 'template1' },
        'projects/plain': { userIds: ['joiner'] },
    })
}

const request = (uid, data) => ({ auth: uid ? { uid } : null, data })

describe('resolveGuideJoinEmailRequest', () => {
    test('reports the caller to the template creator and the administrator only', async () => {
        const resolved = await resolveGuideJoinEmailRequest(
            seed(),
            request('joiner', { guideId: 'guide1', newUserId: 'victim', usersToReceiveEmailIds: ['spam1', 'spam2'] })
        )
        expect(resolved).toEqual({
            guideId: 'guide1',
            newUserId: 'joiner',
            usersToReceiveEmailIds: ['creator', 'admin'],
        })
    })

    test('rejects a caller who is not a member of the guide', async () => {
        await expect(
            resolveGuideJoinEmailRequest(seed(), request('outsider', { guideId: 'guide1' }))
        ).rejects.toMatchObject({ code: 'permission-denied' })
    })

    test('rejects a project that is not a guide', async () => {
        await expect(
            resolveGuideJoinEmailRequest(seed(), request('joiner', { guideId: 'plain' }))
        ).rejects.toMatchObject({ code: 'failed-precondition' })
    })

    test('rejects an unauthenticated call', async () => {
        await expect(resolveGuideJoinEmailRequest(seed(), request(null, { guideId: 'guide1' }))).rejects.toMatchObject({
            code: 'unauthenticated',
        })
    })
})

describe('buildNewUserJoinedGuideHtml', () => {
    test('escapes every interpolated value', () => {
        const html = buildNewUserJoinedGuideHtml({
            guide: { id: 'guide1', name: '<a href="https://evil.test">Click to verify</a>' },
            newUser: { uid: 'joiner', displayName: '<img src=x onerror=alert(1)>', email: 'a"b@example.com' },
            appUrl: 'https://my.alldone.app/',
            appName: 'Alldone',
        })
        expect(html).not.toContain('<a href')
        expect(html).not.toContain('<img')
        expect(html).toContain('&lt;a href=&quot;https://evil.test&quot;&gt;')
        expect(html).toContain('a&quot;b@example.com')
        expect(html).toContain('https://my.alldone.app/projects/guide1/user/joiner/tasks/open')
    })
})
