const {
    FEED_PUBLIC_FOR_ALL,
    getAccessibleProjectIdsFromUserData,
    canAccessObject,
    filterReadableObjects,
    assertProjectAccess,
    assertObjectAccess,
} = require('./privacyAccess')

function makeDoc(data) {
    return {
        exists: !!data,
        data: () => data,
    }
}

function makeDb(docsByPath) {
    return {
        collection: collectionPath => ({
            doc: docId => ({
                get: jest.fn(async () => makeDoc(docsByPath[`${collectionPath}/${docId}`])),
            }),
        }),
        doc: path => ({
            get: jest.fn(async () => makeDoc(docsByPath[path])),
        }),
    }
}

describe('privacyAccess', () => {
    test('collects active, archived, guide, and template project ids', () => {
        expect(
            getAccessibleProjectIdsFromUserData({
                projectIds: ['p1', 'p2'],
                archivedProjectIds: ['p3'],
                guideProjectIds: ['p4'],
                templateProjectIds: ['p5'],
            })
        ).toEqual(['p1', 'p2', 'p4', 'p5', 'p3'])
    })

    test('checks object access using isPublicFor only', () => {
        expect(canAccessObject({ isPublicFor: [FEED_PUBLIC_FOR_ALL] }, 'user-1')).toBe(true)
        expect(canAccessObject({ isPublicFor: ['user-1'] }, 'user-1')).toBe(true)
        expect(canAccessObject({ isPrivate: false, isPublicFor: ['user-2'] }, 'user-1')).toBe(false)
        expect(
            filterReadableObjects(
                [
                    { id: 'visible', isPublicFor: ['user-1'] },
                    { id: 'hidden', isPublicFor: [] },
                ],
                'user-1'
            )
        ).toEqual([{ id: 'visible', isPublicFor: ['user-1'] }])
    })

    test('asserts project membership before object access', async () => {
        const db = makeDb({
            'users/user-1': { projectIds: ['project-1'] },
            'items/project-1/tasks/task-1': { isPublicFor: ['user-1'] },
            'items/project-1/tasks/task-hidden': { isPublicFor: ['user-2'] },
        })

        await expect(assertProjectAccess(db, 'user-1', 'project-1')).resolves.toMatchObject({
            projectIds: ['project-1'],
        })
        await expect(assertProjectAccess(db, 'user-1', 'project-2')).rejects.toThrow(
            'User does not have access to this project'
        )
        await expect(assertObjectAccess(db, 'user-1', 'project-1', 'tasks', 'task-1')).resolves.toBe(true)
        await expect(assertObjectAccess(db, 'user-1', 'project-1', 'tasks', 'task-hidden')).rejects.toThrow(
            'User does not have access to this object'
        )
    })
})
