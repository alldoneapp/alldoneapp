/**
 * @jest-environment node
 */

const indexConfig = require('../../firestore.indexes.json')

const hasExactIndex = (collectionGroup, expectedFields) =>
    indexConfig.indexes.some(index => {
        if (index.collectionGroup !== collectionGroup || index.queryScope !== 'COLLECTION') return false
        if (index.fields?.length !== expectedFields.length) return false

        return expectedFields.every((expected, indexPosition) => {
            const actual = index.fields[indexPosition]
            return (
                actual?.fieldPath === expected.fieldPath &&
                actual?.arrayConfig === expected.arrayConfig &&
                actual?.order === expected.order
            )
        })
    })

describe('Required Firestore indexes', () => {
    it('declares the overdue Goal task transition index', () => {
        expect(
            hasExactIndex('tasks', [
                { fieldPath: 'readerIds', arrayConfig: 'CONTAINS' },
                { fieldPath: 'completed', order: 'ASCENDING' },
                { fieldPath: 'currentReviewerId', order: 'ASCENDING' },
                { fieldPath: 'done', order: 'ASCENDING' },
                { fieldPath: 'isSubtask', order: 'ASCENDING' },
                { fieldPath: 'parentGoalId', order: 'ASCENDING' },
                { fieldPath: 'dueDate', order: 'ASCENDING' },
            ])
        ).toBe(true)
    })

    it('declares the collection-group index used by expired undo cleanup', () => {
        const expiresAtOverride = indexConfig.fieldOverrides.find(
            override => override.collectionGroup === 'undoActions' && override.fieldPath === 'expiresAt'
        )

        expect(expiresAtOverride).toEqual({
            collectionGroup: 'undoActions',
            fieldPath: 'expiresAt',
            ttl: false,
            indexes: [
                { order: 'ASCENDING', queryScope: 'COLLECTION' },
                { order: 'DESCENDING', queryScope: 'COLLECTION' },
                { arrayConfig: 'CONTAINS', queryScope: 'COLLECTION' },
                { order: 'ASCENDING', queryScope: 'COLLECTION_GROUP' },
            ],
        })
    })

    it('expires idempotency claims for server-owned task statistics', () => {
        expect(
            indexConfig.fieldOverrides.find(
                override => override.collectionGroup === 'taskStatisticsEvents' && override.fieldPath === 'expiresAt'
            )
        ).toEqual({
            collectionGroup: 'taskStatisticsEvents',
            fieldPath: 'expiresAt',
            ttl: true,
            indexes: [],
        })
    })
})
