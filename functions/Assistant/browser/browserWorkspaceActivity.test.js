const { resolveBrowserActivity } = require('./browserWorkspaceActivity')
const { FirestoreDouble } = require('./__browserFirestoreDouble')

const args = { projectId: 'p1', objectId: 'task1', objectType: 'tasks', requestUserId: 'user1' }
it('follows the assistant answer that initiated browsing even when the browser is bound to another task', async () => {
    const db = new FirestoreDouble()
    expect(
        await resolveBrowserActivity({
            ...args,
            db,
            runtime: {
                projectId: 'p2',
                objectId: 'chat1',
                objectType: 'topics',
                assistantCommentId: 'answer1',
            },
        })
    ).toEqual({ projectId: 'p2', objectId: 'chat1', objectType: 'topics', commentId: 'answer1' })
})

it('resolves the real VM progress comment for browser calls coming from its task', async () => {
    const db = new FirestoreDouble({
        'vmSessions/p1__task1': { activeCorrelationId: 'vm1' },
        'pendingWebhooks/vm1': {
            kind: 'vm_job',
            userId: 'user1',
            projectId: 'p1',
            objectId: 'task1',
            statusCommentId: 'progress1',
        },
    })
    expect(await resolveBrowserActivity({ ...args, db })).toEqual({
        projectId: 'p1',
        objectId: 'task1',
        objectType: 'tasks',
        commentId: 'progress1',
    })
    await db.doc('pendingWebhooks/vm1').set({ userId: 'someone-else' }, { merge: true })
    expect(await resolveBrowserActivity({ ...args, db })).toBeNull()
})

it('does not treat a warm idle VM or an untracked browser as active work', async () => {
    const db = new FirestoreDouble({ 'vmSessions/p1__task1': { status: 'idle_running', activeCorrelationId: null } })
    expect(await resolveBrowserActivity({ ...args, db })).toBeNull()
    expect(await resolveBrowserActivity({ ...args, db, objectType: 'topics' })).toBeNull()
})
