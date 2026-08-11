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

describe('SearchService direct note lookup', () => {
    test('uses the caller userId when checking direct note access', async () => {
        const get = jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({
                title: 'Direct note',
                isPublicFor: ['user-1'],
            }),
        })
        const doc = jest.fn(() => ({ get }))
        const service = new SearchService({
            database: { doc },
        })

        await expect(
            service.findNoteById('note-1', [{ id: 'project-1', name: 'Project 1' }], 'user-1')
        ).resolves.toEqual({
            note: {
                title: 'Direct note',
                isPublicFor: ['user-1'],
                id: 'note-1',
            },
            projectId: 'project-1',
            projectName: 'Project 1',
        })

        expect(doc).toHaveBeenCalledWith('noteItems/project-1/notes/note-1')
    })
})
