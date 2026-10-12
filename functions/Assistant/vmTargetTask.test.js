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
function makeDb({ user = { projectIds: [PROJECT_ID] }, projectUserIds = [USER_ID], task, extraDocs = {} } = {}) {
    const docs = {
        [`users/${USER_ID}`]: user,
        [`projects/${PROJECT_ID}`]: { userIds: projectUserIds },
    }
    if (task) docs[taskDocPath(PROJECT_ID, TASK_ID)] = task

    Object.assign(docs, extraDocs)

    const snapFor = path =>
        Object.prototype.hasOwnProperty.call(docs, path)
            ? { exists: true, data: () => docs[path] }
            : { exists: false, data: () => undefined }

    return {
        doc: jest.fn(path => ({ get: async () => snapFor(path) })),
        collection: jest.fn(name => ({
            where: () => ({
                get: async () => ({
                    docs: Object.entries(docs)
                        .filter(([path, data]) => path.startsWith('projects/') && data.userIds.includes(USER_ID))
                        .map(([path]) => ({ id: path.split('/')[1] })),
                }),
            }),
            doc: id => ({ get: async () => snapFor(`${name}/${id}`) }),
        })),
    }
}

describe('resolveVmTargetTask', () => {
    it('selects an existing public task without requiring a previous VM session', async () => {
        const db = makeDb({ task: { name: 'Fix toolbar', isPublicFor: [0] } })

        await expect(
            resolveVmTargetTask({ db, projectId: PROJECT_ID, taskId: TASK_ID, requestUserId: USER_ID })
        ).resolves.toEqual({
            ok: true,
            projectId: PROJECT_ID,
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
            projectId: PROJECT_ID,
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

        expect(result).toEqual({ ok: false, message: 'That task was not found in your accessible projects.' })
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
            projectId: PROJECT_ID,
            objectType: 'tasks',
            objectId: TASK_ID,
            isPublicFor: [0],
        })
    })
})

describe('cross-project VM task routing', () => {
    const params = { projectId: PROJECT_ID, taskId: TASK_ID, requestUserId: USER_ID }
    const otherProject = {
        'projects/private': { userIds: [USER_ID] },
        [taskDocPath('private', TASK_ID)]: { name: 'Review architecture', isPublicFor: [USER_ID] },
    }

    it('finds the task in another member project even when users.projectIds is stale', async () => {
        const db = makeDb({ extraDocs: otherProject })
        await expect(resolveVmTargetTask({ db, ...params })).resolves.toMatchObject({
            ok: true,
            projectId: 'private',
            objectId: TASK_ID,
            isPublicFor: [USER_ID],
        })
    })

    it('prefers the originating task project over an assistant-home task with the same ID', async () => {
        const db = makeDb({ task: { isPublicFor: [0] }, extraDocs: otherProject })
        await expect(resolveVmTargetTask({ db, ...params, preferredProjectId: 'private' })).resolves.toMatchObject({
            ok: true,
            projectId: 'private',
        })
    })

    it('honors an explicit project without falling back to a same-ID task elsewhere', async () => {
        const db = makeDb({ extraDocs: otherProject })
        await expect(resolveVmTargetTask({ db, ...params, targetProjectId: PROJECT_ID })).resolves.toEqual({
            ok: false,
            message: 'That task does not exist in the specified project.',
        })
        expect(db.doc).not.toHaveBeenCalledWith(taskDocPath('private', TASK_ID))
        await expect(resolveVmTargetTask({ db, ...params, targetProjectId: 'private' })).resolves.toMatchObject({
            ok: true,
            projectId: 'private',
        })
    })

    it('rejects ambiguous cross-project matches instead of choosing one by query order', async () => {
        const db = makeDb({
            extraDocs: {
                ...otherProject,
                'projects/second': { userIds: [USER_ID] },
                [taskDocPath('second', TASK_ID)]: { isPublicFor: [0] },
            },
        })
        const result = await resolveVmTargetTask({ db, ...params })
        expect(result.ok).toBe(false)
        expect(result.message).toContain('target_project_id')
    })

    it('excludes nonmember projects and private tasks the user cannot read', async () => {
        const db = makeDb({
            extraDocs: {
                ...otherProject,
                [taskDocPath('private', TASK_ID)]: { isPublicFor: ['someone-else'] },
                'projects/nonmember': { userIds: ['someone-else'] },
                [taskDocPath('nonmember', TASK_ID)]: { isPublicFor: [0] },
            },
        })
        await expect(resolveVmTargetTask({ db, ...params })).resolves.toEqual({
            ok: false,
            message: 'You do not have access to that task.',
        })
        expect(db.doc).not.toHaveBeenCalledWith(taskDocPath('nonmember', TASK_ID))
        await expect(resolveVmTargetTask({ db, ...params, targetProjectId: 'nonmember' })).resolves.toEqual({
            ok: false,
            message: 'You do not have access to that task.',
        })
    })

    it('does not turn a read failure into a missing-task fallback', async () => {
        const db = makeDb({ extraDocs: otherProject })
        db.doc.mockImplementation(() => ({
            get: async () => {
                throw new Error('unavailable')
            },
        }))
        await expect(resolveVmTargetTask({ db, ...params })).resolves.toEqual({
            ok: false,
            message: 'Could not use that task for the VM run: unavailable',
        })
        expect(db.doc).not.toHaveBeenCalledWith(taskDocPath('private', TASK_ID))
    })
})
