const firestoreIndexes = require('../../firestore.indexes.json')

describe('usersFollowing index configuration', () => {
    test('does not index the unbounded task-id registry map', () => {
        const tasksOverride = firestoreIndexes.fieldOverrides.find(
            override => override.collectionGroup === 'entries' && override.fieldPath === 'tasks'
        )

        expect(tasksOverride).toEqual({
            collectionGroup: 'entries',
            fieldPath: 'tasks',
            ttl: false,
            indexes: [],
        })
    })
})
