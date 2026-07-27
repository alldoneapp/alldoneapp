const { resolveVmTargetTask, taskDocPath } = require('./vmTargetTask')

const PROJECT_ID = 'project-1'
const TASK_ID = 'task-1'
const USER_ID = 'user-1'

function makeDb({ user = { projectIds: [PROJECT_ID] }, task } = {}) {
    const docs = {
        [`users/${USER_ID}`]: user,
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
            db: makeDb({ user: { projectIds: [] }, task: { isPublicFor: [0] } }),
            projectId: PROJECT_ID,
            taskId: TASK_ID,
            requestUserId: USER_ID,
        })

        expect(result).toEqual({ ok: false, message: 'You do not have access to that task.' })
    })
})
