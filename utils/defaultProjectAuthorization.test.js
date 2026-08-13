import {
    DEFAULT_PROJECT_OWNERSHIP_ERROR,
    assertProjectOwnedByUser,
    getProjectsOwnedByUser,
    isProjectOwnedByUser,
    validateDefaultProjectSelection,
} from './defaultProjectAuthorization'

describe('default project authorization', () => {
    const ownProject = { id: 'own-project', creatorId: 'user-1' }
    const otherUsersProject = { id: 'other-project', creatorId: 'user-2' }

    test('allows a project created by the user', () => {
        expect(isProjectOwnedByUser(ownProject, 'user-1')).toBe(true)
        expect(() => assertProjectOwnedByUser(ownProject, 'user-1')).not.toThrow()
    })

    test('rejects a project created by another user', () => {
        expect(isProjectOwnedByUser(otherUsersProject, 'user-1')).toBe(false)
        expect(() => assertProjectOwnedByUser(otherUsersProject, 'user-1')).toThrow(DEFAULT_PROJECT_OWNERSHIP_ERROR)
    })

    test('validates a persisted project before a default-project mutation', async () => {
        const loadOwnProject = jest.fn().mockResolvedValue(ownProject)
        const loadOtherUsersProject = jest.fn().mockResolvedValue(otherUsersProject)

        await expect(validateDefaultProjectSelection('user-1', 'own-project', loadOwnProject)).resolves.toBe(ownProject)
        await expect(validateDefaultProjectSelection('user-1', 'other-project', loadOtherUsersProject)).rejects.toThrow(
            DEFAULT_PROJECT_OWNERSHIP_ERROR
        )
        expect(loadOwnProject).toHaveBeenCalledWith('own-project')
        expect(loadOtherUsersProject).toHaveBeenCalledWith('other-project')
    })

    test('allows clearing the default project without loading a project', async () => {
        const loadProject = jest.fn()

        await expect(validateDefaultProjectSelection('user-1', '', loadProject)).resolves.toBeNull()
        expect(loadProject).not.toHaveBeenCalled()
    })

    test('only exposes owned projects to the default-project picker', () => {
        expect(getProjectsOwnedByUser([ownProject, otherUsersProject], 'user-1')).toEqual([ownProject])
    })
})
