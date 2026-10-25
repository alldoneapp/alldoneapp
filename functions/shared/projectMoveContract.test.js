'use strict'

const {
    getProjectMoveCollectionType,
    normalizeProjectMoveType,
    SUPPORTED_PROJECT_MOVE_TYPES,
} = require('./projectMoveContract')

describe('project move contract', () => {
    test('supports all object types exposed by the client picker', () => {
        expect(SUPPORTED_PROJECT_MOVE_TYPES).toEqual(['task', 'note', 'goal', 'contact', 'chat', 'skill'])
    })

    test.each([
        ['task', 'tasks'],
        ['notes', 'notes'],
        ['goal', 'goals'],
        ['contacts', 'contacts'],
        ['chat', 'topics'],
        ['skills', 'skills'],
    ])('normalizes %s to the access collection %s', (input, collection) => {
        expect(getProjectMoveCollectionType(input)).toBe(collection)
    })

    test('rejects unsupported types', () => {
        expect(normalizeProjectMoveType('assistant')).toBeNull()
    })
})
