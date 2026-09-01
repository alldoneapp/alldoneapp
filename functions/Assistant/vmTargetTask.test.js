const { resolveVmTargetTask, taskDocPath } = require('./vmTargetTask')

const PROJECT_ID = 'project-1'
const TASK_ID = 'task-1'
const USER_ID = 'user-1'

// Project membership is read from the PROJECT document's `userIds`, not from the user document's
// `projectIds`. Those are two different things: the project doc is the authority the security rules
// use, while the user's list is a client-maintained projection of it. This double seeded only the
// user side, which was how access was checked until "Harden Firestore access rollout" (6009eabd85)
// moved it to the project doc — after which every case in this file failed at the project gate, and
// the two rejection cases went on "passing" without ever reaching the check they were written for.
function makeDb({ user = { projectIds: [PROJECT_ID] }, projectUserIds = [USER_ID], task } = {}) {
    const docs = {
        [`users/${USER_ID}`]: user,
        [`projects/${PROJECT_ID}`]: { userIds: projectUserIds },
    }
    if (task) docs[taskDocPath(PROJECT_ID, TASK_ID)] = task

    const snapFor = path =>
        Object.prototype.hasOwnProperty.call(docs, path)
            ? { exists: true, data: () => docs[path] }
            : { exists: false, data: () => undefined }

    return {
        doc: path => ({ get: async () => snapFor(path) }),
        collection: name => ({
            doc: id => ({ get: async () => snapFor(`${name}/${id}`) }),
        }),
    }
}

describe('resolveVmTargetTask', () => {
    it('selects an existing public task without requiring a previous VM session', async () => {
        const db = makeDb({ task: { name: 'Fix toolbar', isPublicFor: [0] } })

        await expect(
            resolveVmTargetTask({ db, projectId: PROJECT_ID, taskId: TASK_ID, requestUserId: USER_ID })
        ).resolves.toEqual({
            ok: true,
            objectType: 'tasks',
            objectId: TASK_ID,
            isPublicFor: [0],
        })
    })

    it('selects a private task shared with the requesting user', async () => {
        const db = makeDb({ task: { isPublicFor: [USER_ID] } })

        const result = await resolveVmTargetTask({
            db,
            projectId: PROJECT_ID,
            taskId: `  ${TASK_ID}  `,
            requestUserId: USER_ID,
        })

        expect(result).toEqual({
            ok: true,
            objectType: 'tasks',
            objectId: TASK_ID,
            isPublicFor: [USER_ID],
        })
    })

    it('rejects a missing task', async () => {
        const result = await resolveVmTargetTask({
            db: makeDb(),
            projectId: PROJECT_ID,
            taskId: TASK_ID,
            requestUserId: USER_ID,
        })

        expect(result).toEqual({ ok: false, message: 'That task does not exist in the current project.' })
    })

    it('rejects a task the requesting user cannot see', async () => {
        const result = await resolveVmTargetTask({
            db: makeDb({ task: { isPublicFor: ['another-user'] } }),
            projectId: PROJECT_ID,
            taskId: TASK_ID,
            requestUserId: USER_ID,
        })

        expect(result).toEqual({ ok: false, message: 'You do not have access to that task.' })
    })

    it('rejects a task in a project the requesting user cannot access', async () => {
        const result = await resolveVmTargetTask({
            db: makeDb({ projectUserIds: [], task: { isPublicFor: [0] } }),
            projectId: PROJECT_ID,
            taskId: TASK_ID,
            requestUserId: USER_ID,
        })

        expect(result).toEqual({ ok: false, message: 'You do not have access to that task.' })
    })

    it('reads membership from the project document, not the user document', async () => {
        // The stale-double failure in reverse: a user whose own projectIds still list a project they
        // were removed from must not reach the task. Without this, a double that drifts back to the
        // user-side list would make every case above pass again while checking nothing.
        const removedFromProject = await resolveVmTargetTask({
            db: makeDb({ user: { projectIds: [PROJECT_ID] }, projectUserIds: [], task: { isPublicFor: [0] } }),
            projectId: PROJECT_ID,
            taskId: TASK_ID,
            requestUserId: USER_ID,
        })
        expect(removedFromProject).toEqual({ ok: false, message: 'You do not have access to that task.' })

        // ...and a member whose user document has not caught up is still let through.
        const staleUserProjection = await resolveVmTargetTask({
            db: makeDb({ user: {}, projectUserIds: [USER_ID], task: { isPublicFor: [0] } }),
            projectId: PROJECT_ID,
            taskId: TASK_ID,
            requestUserId: USER_ID,
        })
        expect(staleUserProjection).toEqual({
            ok: true,
            objectType: 'tasks',
            objectId: TASK_ID,
            isPublicFor: [0],
        })
    })
})
