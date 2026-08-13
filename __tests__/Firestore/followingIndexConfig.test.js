const firestoreIndexes = require('../../firestore.indexes.json')

const entriesOverride = fieldPath =>
    firestoreIndexes.fieldOverrides.find(
        override => override.collectionGroup === 'entries' && override.fieldPath === fieldPath
    )

describe('usersFollowing index configuration', () => {
    test('does not index the unbounded task-id registry map', () => {
        expect(entriesOverride('tasks')).toEqual({
            collectionGroup: 'entries',
            fieldPath: 'tasks',
            ttl: false,
            indexes: [],
        })
    })

    /**
     * `usersFollowing/{projectId}/entries/{userId}` is only ever read and written by direct
     * document reference — there is no `where`, `orderBy` or `collectionGroup('entries')` query
     * anywhere in the app or the functions, and the file declares no composite index on it. So
     * automatic single-field indexing buys nothing here and only costs write amplification plus
     * the risk of "index entry too large" failures on any unbounded field (the `tasks` map above
     * being the one that actually hit it). The wildcard exemption covers every field at once,
     * which is why it exists in production alongside the enumerated per-field entries.
     */
    test('disables single-field indexing for the whole collection group', () => {
        expect(entriesOverride('*')).toEqual({
            collectionGroup: 'entries',
            fieldPath: '*',
            ttl: false,
            indexes: [],
        })
    })

    // A composite index would be a real query arriving on this collection group, which would make
    // the blanket exemption above wrong — fail loudly rather than silently breaking that query.
    test('has no composite index that the blanket exemption would contradict', () => {
        expect((firestoreIndexes.indexes || []).filter(index => index.collectionGroup === 'entries')).toEqual([])
    })
})
