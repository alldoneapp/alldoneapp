'use strict'

// Security audit 2026-11: onRemoveWorkstreamSecondGen re-scoped tasks and goals of any project for
// any streamId a signed-in caller named.

const { createFirestoreDouble } = require('../Assistant/__securityFirestoreDouble')
const { assertWorkstreamRemovalAllowed } = require('./workstreamRemovalAccess')

function seed() {
    return createFirestoreDouble({
        'users/member': {},
        'users/outsider': {},
        'projects/p1': { userIds: ['member', 'colleague'] },
        'projectsWorkstreams/p1/workstreams/ws@design': { displayName: 'Design' },
    })
}

const request = (uid, data) => ({ auth: uid ? { uid } : null, data })

describe('assertWorkstreamRemovalAllowed', () => {
    test('lets a member remove an existing workstream of the project', async () => {
        await expect(
            assertWorkstreamRemovalAllowed(seed(), request('member', { projectId: 'p1', streamId: 'ws@design' }))
        ).resolves.toEqual({ uid: 'member', projectId: 'p1', streamId: 'ws@design' })
    })

    test('rejects an unauthenticated call', async () => {
        await expect(
            assertWorkstreamRemovalAllowed(seed(), request(null, { projectId: 'p1', streamId: 'ws@design' }))
        ).rejects.toMatchObject({ code: 'unauthenticated' })
    })

    test('rejects a caller who is not a member of the project', async () => {
        await expect(
            assertWorkstreamRemovalAllowed(seed(), request('outsider', { projectId: 'p1', streamId: 'ws@design' }))
        ).rejects.toMatchObject({ code: 'permission-denied' })
    })

    test.each([['colleague'], ['ws@default'], ['ws@missing'], ['ws@design/../x']])(
        'rejects %s, which is not a removable workstream of the project',
        async streamId => {
            await expect(
                assertWorkstreamRemovalAllowed(seed(), request('member', { projectId: 'p1', streamId }))
            ).rejects.toMatchObject({ code: 'invalid-argument' })
        }
    )
})
