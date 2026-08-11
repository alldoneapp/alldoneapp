/**
 * AT-2258 — "filter search results to only objects I have created".
 *
 * The Search popup builds Algolia `filters:` strings like `userId:"<uid>"`.
 * Algolia only accepts a `filters:` expression on an attribute that is declared
 * in that index's `attributesForFaceting`; filtering on an undeclared attribute
 * is rejected outright. So the creator filter is a contract spanning two files
 * that are edited independently:
 *
 *   components/GlobalSearchAlgolia/searchFilters.js -> which attribute is filtered
 *   functions/searchHelper.js `configAlgoliaIndex`  -> which attributes are facetable
 *   functions/ParsingTextHelper.js `map*Data`       -> which attributes exist at all
 *
 * These tests pin all three together, because drift between them fails only at
 * runtime, as an Algolia error swallowed by the search's try/catch — the tab
 * simply renders "no results" and nothing is logged.
 */
jest.mock('firebase-admin', () => ({ firestore: () => ({}) }), { virtual: true })
jest.mock('algoliasearch', () => () => ({ initIndex: () => ({}) }), { virtual: true })

const { mapChatData, mapGoalData } = require('./ParsingTextHelper')
const { configAlgoliaIndex } = require('./searchHelper')

// Mirrors CREATOR_ATTRIBUTE_BY_INDEX in components/GlobalSearchAlgolia/searchFilters.js.
const CREATOR_ATTRIBUTE_BY_OBJECT_TYPE = {
    tasks: 'userId',
    goals: 'creatorId',
    notes: 'userId',
    contacts: 'recorderUserId',
    chats: 'creatorId',
}

const captureSettings = async objectsType => {
    let captured = null
    await configAlgoliaIndex(
        {
            setSettings: async settings => {
                captured = settings
            },
            // The notes branch reads the settings back purely to log them.
            getSettings: async () => captured,
        },
        objectsType
    )
    return captured
}

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

describe('configAlgoliaIndex creator facets', () => {
    it.each(Object.entries(CREATOR_ATTRIBUTE_BY_OBJECT_TYPE))(
        'declares the %s creator attribute (%s) as filterable',
        async (objectsType, creatorAttribute) => {
            const settings = await captureSettings(objectsType)

            expect(settings).not.toBeNull()
            expect(settings.attributesForFaceting).toContain(`filterOnly(${creatorAttribute})`)
        }
    )

    it('still declares the facets the pre-existing access scoping depends on', async () => {
        for (const objectsType of Object.keys(CREATOR_ATTRIBUTE_BY_OBJECT_TYPE)) {
            const settings = await captureSettings(objectsType)

            expect(settings.attributesForFaceting).toContain('filterOnly(projectId)')
            expect(settings.attributesForFaceting).toContain('filterOnly(isPublicFor)')
        }
    })

    it('keeps the contacts assistant facet the contacts search filters on', async () => {
        const settings = await captureSettings('contacts')

        expect(settings.attributesForFaceting).toContain('filterOnly(isAssistant)')
    })
})
