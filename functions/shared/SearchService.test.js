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

// An update_note in production took ~50s per call (2026-09-28): the note was found by reading
// every one of the user's ~190 projects, then every project's note path, one await at a time.
describe('SearchService note lookup cost', () => {
    const makeDatabase = ({ projectIds, notesByPath = {}, projects = {} }) => {
        const reads = []
        const snapshot = data => ({ exists: data !== undefined, data: () => data })
        const database = {
            collection: name => ({
                doc: id => ({
                    get: async () => {
                        reads.push(`${name}/${id}`)
                        if (name === 'users') return snapshot({ projectIds })
                        if (name === 'projects') return snapshot(projects[id] || { name: `Project ${id}` })
                        return snapshot(undefined)
                    },
                }),
            }),
            doc: path => ({
                get: async () => {
                    reads.push(path)
                    return snapshot(notesByPath[path])
                },
            }),
        }
        return { database, reads }
    }

    test('resolves a note in its known project without listing every project', async () => {
        const projectIds = Array.from({ length: 190 }, (_, i) => `p${i}`)
        const { database, reads } = makeDatabase({
            projectIds,
            notesByPath: { 'noteItems/p150/notes/note-1': { title: 'Meeting', isPublicFor: ['user-1'] } },
        })
        const service = new SearchService({ database })
        service.ensureInitialized = async () => {}

        const result = await service.findNotesBySearchCriteria('user-1', { noteId: 'note-1', projectId: 'p150' })

        expect(result.matches).toEqual([
            expect.objectContaining({
                projectId: 'p150',
                matchType: 'direct_id',
                note: expect.objectContaining({ id: 'note-1' }),
            }),
        ])
        expect(reads).toHaveLength(3)
    })

    test('does not let the fast path bypass project membership', async () => {
        const { database } = makeDatabase({
            projectIds: ['p1'],
            notesByPath: { 'noteItems/p9/notes/note-1': { title: 'Foreign', isPublicFor: [0] } },
        })
        const service = new SearchService({ database })

        await expect(service.findNoteInProject('note-1', 'p9', 'user-1')).resolves.toBeNull()
    })

    test('checks the preferred project first and otherwise keeps the first hit in project order', async () => {
        const { database, reads } = makeDatabase({
            projectIds: [],
            notesByPath: {
                'noteItems/p2/notes/note-1': { title: 'In p2', isPublicFor: ['user-1'] },
                'noteItems/p3/notes/note-1': { title: 'In p3', isPublicFor: ['user-1'] },
            },
        })
        const service = new SearchService({ database })
        const projects = ['p1', 'p2', 'p3'].map(id => ({ id, name: id }))

        await expect(service.findNoteById('note-1', projects, 'user-1', 'p3')).resolves.toMatchObject({
            projectId: 'p3',
        })
        expect(reads).toEqual(['noteItems/p3/notes/note-1'])

        await expect(service.findNoteById('note-1', projects, 'user-1')).resolves.toMatchObject({ projectId: 'p2' })
    })

    test('lists projects concurrently but returns them in the user’s order', async () => {
        const { database } = makeDatabase({ projectIds: ['a', 'b', 'c'] })
        const service = new SearchService({ database })

        await expect(service.getUserProjects('user-1')).resolves.toEqual([
            expect.objectContaining({ id: 'a' }),
            expect.objectContaining({ id: 'b' }),
            expect.objectContaining({ id: 'c' }),
        ])
    })
})
