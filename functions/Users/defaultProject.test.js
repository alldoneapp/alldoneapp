'use strict'

const { setDefaultProjectForUser } = require('./defaultProject')

const createDb = project => {
    const update = jest.fn().mockResolvedValue(undefined)
    const get = jest.fn().mockResolvedValue({
        exists: !!project,
        data: () => project,
    })
    const doc = jest.fn(path => (path.startsWith('projects/') ? { get } : { update }))
    return { db: { doc }, doc, get, update }
}

describe('setDefaultProjectForUser', () => {
    test('allows an owned project and persists it for the authenticated user', async () => {
        const { db, get, update } = createDb({ creatorId: 'user-1' })

        await expect(setDefaultProjectForUser(db, 'user-1', 'own-project')).resolves.toEqual({
            success: true,
            defaultProjectId: 'own-project',
        })
        expect(get).toHaveBeenCalledTimes(1)
        expect(update).toHaveBeenCalledWith({ defaultProjectId: 'own-project' })
    })

    test("rejects another user's project without updating the user", async () => {
        const { db, update } = createDb({ creatorId: 'user-2' })

        await expect(setDefaultProjectForUser(db, 'user-1', 'other-project')).rejects.toMatchObject({
            code: 'permission-denied',
        })
        expect(update).not.toHaveBeenCalled()
    })

    test('allows clearing the setting for project-removal fallback', async () => {
        const { db, get, update } = createDb(null)

        await expect(setDefaultProjectForUser(db, 'user-1', '')).resolves.toEqual({
            success: true,
            defaultProjectId: '',
        })
        expect(get).not.toHaveBeenCalled()
        expect(update).toHaveBeenCalledWith({ defaultProjectId: '' })
    })
})
