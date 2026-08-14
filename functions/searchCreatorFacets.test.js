/**
 * AT-2258 — "filter search results to only objects I have created" — ported to Typesense
 * in Phase 5 of the search migration.
 *
 * The search popup builds `filter_by` strings like `userId:=\`<uid>\``. Typesense only
 * accepts filters on fields declared in the collection schema, so the creator filter is a
 * contract spanning files that are edited independently:
 *
 *   components/GlobalSearchAlgolia/typesenseSearchFilters.js -> which attribute is filtered
 *   functions/typesenseHelper.js COLLECTION_SCHEMAS          -> which fields are declared
 *   functions/ParsingTextHelper.js `map*Data`                -> which attributes exist at all
 *
 * These tests pin all three together, because drift between them fails only at runtime as
 * a swallowed per-search error — the tab simply renders "no results".
 */
jest.mock('firebase-admin', () => ({ firestore: () => ({}) }), { virtual: true })
jest.mock('./envFunctionsHelper', () => ({ getEnvFunctions: () => ({}) }))

const { mapChatData, mapGoalData } = require('./ParsingTextHelper')
const { COLLECTION_SCHEMAS } = require('./typesenseHelper')

// Mirrors CREATOR_ATTRIBUTE_BY_INDEX in components/GlobalSearchAlgolia/typesenseSearchFilters.js.
const CREATOR_ATTRIBUTE_BY_COLLECTION = {
    dev_tasks: 'userId',
    dev_goals: 'creatorId',
    dev_notes: 'userId',
    dev_contacts: 'recorderUserId',
    dev_updates: 'creatorId',
}

const schemaFieldNames = collection => COLLECTION_SCHEMAS[collection].fields.map(field => field.name)

describe('mapChatData creator attribute', () => {
    it('indexes the topic creator so chats can be filtered by creator', () => {
        const record = mapChatData('chat-1', 'chat-1project-1', { name: 'Standup', creatorId: 'user-1' }, 'project-1')

        expect(record.creatorId).toBe('user-1')
    })

    it('falls back to an empty string rather than undefined for a creatorless topic', () => {
        // An `undefined` value is dropped from the Algolia record entirely,
        // which is indistinguishable from a record indexed before this change.
        // An empty string is a real value that simply never equals a uid.
        const record = mapChatData('chat-1', 'chat-1project-1', { name: 'Standup' }, 'project-1')

        expect(record.creatorId).toBe('')
    })

    it('keeps the searchable attributes untouched', () => {
        const record = mapChatData(
            'chat-1',
            'chat-1project-1',
            { name: 'Standup', creatorId: 'user-1', commentsData: { lastComment: 'hello' } },
            'project-1'
        )

        expect(record.name).toBe('Standup')
        expect(record.cleanName).toBeDefined()
        expect(record.cleanLastComment).toBeDefined()
        expect(record.projectId).toBe('project-1')
    })
})

describe('mapGoalData creator attribute', () => {
    it('indexes the goal creator so goals can be filtered by creator', () => {
        const record = mapGoalData('goal-1', 'goal-1project-1', { name: 'Ship it', creatorId: 'user-1' }, 'project-1')

        expect(record.creatorId).toBe('user-1')
    })

    it('falls back to an empty string rather than undefined for a creatorless goal', () => {
        const record = mapGoalData('goal-1', 'goal-1project-1', { name: 'Ship it' }, 'project-1')

        expect(record.creatorId).toBe('')
    })

    it('does not confuse the creator with ownerId, which is the ALL_USERS sentinel', () => {
        // Regression guard for the original AT-2258 mapping. Every goal in the
        // production index carries `ownerId: "ALL_USERS"`, so filtering the goals
        // tab on `ownerId` matched nothing at all. `ownerId` must keep its own
        // meaning and must not be overwritten with the creator.
        const record = mapGoalData('goal-1', 'goal-1project-1', { name: 'Ship it', creatorId: 'user-1' }, 'project-1')

        expect(record.ownerId).toBe('ALL_USERS')
        expect(record.creatorId).toBe('user-1')
        expect(record.creatorId).not.toBe(record.ownerId)
    })
})

describe('Typesense schema creator fields', () => {
    it.each(Object.entries(CREATOR_ATTRIBUTE_BY_COLLECTION))(
        'declares the %s creator attribute (%s) in the schema',
        (collection, creatorAttribute) => {
            expect(schemaFieldNames(collection)).toContain(creatorAttribute)
        }
    )

    it('still declares the fields the pre-existing access scoping depends on', () => {
        for (const collection of Object.keys(CREATOR_ATTRIBUTE_BY_COLLECTION)) {
            const names = schemaFieldNames(collection)
            expect(names).toContain('projectId')
            expect(names).toContain('isPublicFor')
        }
    })

    it('keeps the contacts assistant field the contacts search filters on', () => {
        expect(schemaFieldNames('dev_contacts')).toContain('isAssistant')
    })
})
