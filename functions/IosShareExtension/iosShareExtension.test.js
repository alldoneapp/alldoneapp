'use strict'

const {
    buildTaskEndpointUrl,
    createIosShareTask,
    mintIosShareExtensionToken,
    normalizeInstallationId,
    normalizeTaskName,
    revokeIosShareExtensionToken,
} = require('./iosShareExtension')

const createDb = existing => {
    const store = new Map(Object.entries(existing || {}))
    const doc = path => ({
        path,
        get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
        set: async (value, options) => {
            store.set(path, options?.merge ? { ...(store.get(path) || {}), ...value } : value)
        },
    })
    return {
        store,
        doc,
        runTransaction: async callback =>
            callback({
                get: async ref => ({ exists: store.has(ref.path), data: () => store.get(ref.path) }),
                set: (ref, value, options) => {
                    store.set(ref.path, options?.merge ? { ...(store.get(ref.path) || {}), ...value } : value)
                },
                delete: ref => store.delete(ref.path),
            }),
    }
}

describe('iOS share extension backend', () => {
    it('validates installation IDs and shared task names', () => {
        expect(normalizeInstallationId('3EA4AE5E-2B7B-4BC8-86DE-19BA8D72C7D8')).toBe(
            '3EA4AE5E-2B7B-4BC8-86DE-19BA8D72C7D8'
        )
        expect(normalizeInstallationId('../bad')).toBe('')
        expect(normalizeTaskName('  https://example.com  ')).toBe('https://example.com')
        expect(normalizeTaskName('x'.repeat(501))).toBe('')
    })

    it('builds the environment-specific HTTPS endpoint', () => {
        expect(buildTaskEndpointUrl('alldonestaging')).toBe(
            'https://europe-west1-alldonestaging.cloudfunctions.net/iosShareTask'
        )
    })

    it('stores only hashed, rotatable credentials and revokes them on logout', async () => {
        const db = createDb({ 'users/user-1': { displayName: 'User' } })
        const randomBytes = jest.fn().mockReturnValueOnce(Buffer.alloc(32, 1)).mockReturnValueOnce(Buffer.alloc(32, 2))
        const installationId = '3EA4AE5E-2B7B-4BC8-86DE-19BA8D72C7D8'
        const deps = { db, now: 1000, projectId: 'alldonestaging', randomBytes }

        const first = await mintIosShareExtensionToken('user-1', installationId, deps)
        const second = await mintIosShareExtensionToken('user-1', installationId, { ...deps, now: 2000 })
        const tokenEntries = [...db.store.entries()].filter(([path]) => path.startsWith('iosShareExtensionTokens/'))

        expect(first.token).toMatch(/^adshare_[a-f0-9]{64}$/)
        expect(second.token).not.toBe(first.token)
        expect([...db.store.keys()].join('\n')).not.toContain(first.token)
        expect(tokenEntries).toHaveLength(2)
        expect(tokenEntries.map(([, value]) => value.revoked)).toEqual(expect.arrayContaining([true, false]))

        await expect(revokeIosShareExtensionToken('user-1', installationId, { db, now: 3000 })).resolves.toEqual({
            success: true,
        })
        expect(
            [...db.store.values()].filter(value => value?.appId === 'ios-share-extension').every(value => value.revoked)
        ).toBe(true)
        expect([...db.store.keys()].some(path => path.startsWith('iosShareExtensionInstallations/'))).toBe(false)
    })

    it('creates one automatically routed task and reuses its idempotent result', async () => {
        const db = createDb()
        const persistTask = jest.fn(async ({ taskName, userId }) => ({
            taskId: 'task-1',
            projectId: 'project-1',
            taskName,
            userId,
        }))
        const deps = {
            db,
            now: 1000,
            resolveToken: jest.fn(async () => ({ userId: 'user-1', userData: { defaultProjectId: 'project-1' } })),
            persistTask,
        }
        const request = { token: 'token', taskName: 'https://example.com', requestId: 'request-123' }

        await expect(createIosShareTask(request, deps)).resolves.toMatchObject({
            taskId: 'task-1',
            projectId: 'project-1',
        })
        await expect(createIosShareTask(request, deps)).resolves.toMatchObject({ taskId: 'task-1' })
        expect(persistTask).toHaveBeenCalledTimes(1)
        expect(persistTask).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'user-1', taskName: 'https://example.com' })
        )
    })

    it('rejects missing credentials before attempting persistence', async () => {
        const persistTask = jest.fn()
        await expect(
            createIosShareTask(
                { token: 'bad', taskName: 'Task', requestId: 'request-123' },
                { db: createDb(), resolveToken: async () => null, persistTask }
            )
        ).rejects.toMatchObject({ status: 401 })
        expect(persistTask).not.toHaveBeenCalled()
    })
})
