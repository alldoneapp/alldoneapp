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
    describe('readerIds access rollout (2026-08-28) — every range/orderBy query needs its own composite', () => {
        // Firestore merges `array-contains` with equality filters on its own, so only the shapes
        // below (an inequality, a `!=`, or an orderBy on top of readerIds) need a composite index.
        // The rollout swapped `isPublicFor array-contains-any` for `readerIds array-contains` in
        // every list query, and a composite is keyed on the exact field set, so each of these had
        // to be created anew. The Done tab shipped without its four and was empty in production.
        const C = { fieldPath: 'readerIds', arrayConfig: 'CONTAINS' }
        const asc = fieldPath => ({ fieldPath, order: 'ASCENDING' })
        const desc = fieldPath => ({ fieldPath, order: 'DESCENDING' })
        const cases = [
            [
                'tasks',
                'Done tab: newest done tasks (doneTasks.js)',
                [C, asc('inDone'), asc('userId'), desc('completed'), desc('sortIndex')],
            ],
            [
                'tasks',
                'Done tab: earlier done tasks (doneTasks.js)',
                [C, asc('done'), asc('parentId'), asc('userId'), desc('completed')],
            ],
            [
                'tasks',
                'Done tab: earlier done subtasks (doneTasks.js)',
                [C, asc('parentDone'), asc('userId'), asc('completed')],
            ],
            ['tasks', 'Done tab: show-more probe (doneTasks.js)', [C, asc('inDone'), asc('userId'), asc('completed')]],
            ['tasks', 'Goal DV tasks by creation (firestore.js)', [C, asc('parentGoalId'), desc('created')]],
            ['tasks', 'Subtasks by sort order (firestore.js)', [C, asc('parentId'), desc('sortIndex')]],
            [
                'tasks',
                'Goal DV open subtasks, parentId != null (openGoalTasks.js)',
                [C, asc('completed'), asc('parentDone'), asc('parentGoalId'), asc('parentId')],
            ],
            [
                'tasks',
                'Workstream show-more probe (tasksShowMoreButton.js)',
                [C, asc('done'), asc('parentId'), asc('userId'), asc('dueDate')],
            ],
            [
                'tasks',
                'Goal DV workflow subtasks (workflowGoalTasks.js)',
                [C, asc('isSubtask'), asc('parentDone'), asc('parentGoalId'), asc('completed')],
            ],
            [
                'tasks',
                'Goal DV workflow tasks (workflowGoalTasks.js)',
                [C, asc('done'), asc('parentGoalId'), asc('parentId'), asc('completed')],
            ],
            [
                'tasks',
                'Workflow board handed-on tasks (workflowTasks.js)',
                [C, asc('inDone'), asc('userId'), asc('currentReviewerId')],
            ],
            [
                'notes',
                'Notes list by last edition (firestore.js)',
                [C, asc('stickyData.days'), desc('lastEditionDate')],
            ],
            ['notes', 'Sticky notes (firestore.js)', [C, asc('stickyData.days')]],
            ['feeds', 'Object inner feeds (firestore.js)', [C, desc('lastChangeDate')]],
            [
                'items',
                'Goals by owner in milestone window (goalsFirestore.js)',
                [C, asc('ownerId'), asc('completionMilestoneDate')],
            ],
        ]
        it.each(cases)('%s: %s', (collectionGroup, _label, fields) => {
            expect(hasExactIndex(collectionGroup, fields)).toBe(true)
        })
    })
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
