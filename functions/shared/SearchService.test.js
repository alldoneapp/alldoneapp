const { SearchService, ENTITY_TYPES } = require('./SearchService')

describe('SearchService metadata extraction', () => {
    test('does not throw for malformed task date fields', () => {
        const service = new SearchService()

        expect(
            service.extractMetadata(
                {
                    done: false,
                    userId: 'user-1',
                    lastEditionDate: 'not-a-date',
                    created: {},
                    dueDate: 'also-not-a-date',
                },
                ENTITY_TYPES.TASKS
            )
        ).toEqual({
            lastModified: null,
            created: null,
            completed: false,
            assignee: 'user-1',
            dueDate: null,
        })
    })

    test('normalizes common Algolia and Firestore date shapes', () => {
        const service = new SearchService()

        expect(service.toIsoDateOrNull('1781676500000')).toBe('2026-06-17T06:08:20.000Z')
        expect(service.toIsoDateOrNull({ seconds: 1781676500, nanoseconds: 250000000 })).toBe(
            '2026-06-17T06:08:20.250Z'
        )
        expect(service.toIsoDateOrNull({ _seconds: 1781676500, _nanoseconds: 500000000 })).toBe(
            '2026-06-17T06:08:20.500Z'
        )
    })
})
