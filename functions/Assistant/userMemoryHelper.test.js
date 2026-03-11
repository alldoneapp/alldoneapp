const {
    buildUserMemoryEntry,
    getUserMemoryContextMessage,
    isDuplicateUserMemory,
    updateUserMemory,
} = require('./userMemoryHelper')

function createDb(userRecords = {}) {
    const updates = []

    return {
        updates,
        collection: jest.fn(name => {
            if (name === 'users') {
                return {
                    doc: userId => ({
                        get: jest.fn(async () => ({
                            exists: !!userRecords[userId],
                            data: () => userRecords[userId],
                        })),
                        update: jest.fn(async data => {
                            updates.push({ userId, data })
                            const current = userRecords[userId] || {}
                            const next = { ...current }
                            Object.entries(data).forEach(([key, value]) => {
                                if (key.startsWith('noteIdsByProject.')) {
                                    const projectId = key.split('.')[1]
                                    next.noteIdsByProject = { ...(next.noteIdsByProject || {}), [projectId]: value }
                                } else {
                                    next[key] = value
                                }
                            })
                            userRecords[userId] = next
                        }),
                    }),
                }
            }

            if (name === '_') {
                return {
                    doc: () => ({ id: 'generated-note-id' }),
                }
            }

            throw new Error(`Unexpected collection ${name}`)
        }),
    }
}

function createNoteService(overrides = {}) {
    return {
        initialize: jest.fn(async () => {}),
        createAndPersistNote: jest.fn(async () => ({
            noteId: 'created-note-id',
        })),
        getStorageContent: jest.fn(async () => ''),
        addContentToStorage: jest.fn(async () => {}),
        ...overrides,
    }
}

describe('userMemoryHelper', () => {
    test('builds dated user memory entries', () => {
        const entry = buildUserMemoryEntry({
            fact: 'Prefers planning the day the night before',
            category: 'preference',
            reason: 'Helps with daily planning suggestions',
            now: '2026-03-11T08:00:00Z',
        })

        expect(entry).toBe(
            '2026-03-11: [preference] Prefers planning the day the night before (Helps with daily planning suggestions)'
        )
    })

    test('detects duplicate user memories by fact', () => {
        expect(
            isDuplicateUserMemory('2026-03-11: [preference] Prefers planning the day the night before\n', {
                fact: 'Prefers planning the day the night before',
            })
        ).toBe(true)
    })

    test('writes to the current project user note when it already exists', async () => {
        const db = createDb({
            user1: {
                displayName: 'Karsten',
                noteIdsByProject: { projectA: 'note-project-a' },
            },
        })
        const noteService = createNoteService({
            getStorageContent: jest.fn(async () => '# Karsten memory\n\n'),
        })

        const result = await updateUserMemory({
            db,
            projectId: 'projectA',
            requestUserId: 'user1',
            fact: 'Prefers short summaries',
            category: 'preference',
            noteService,
            feedUser: { uid: 'user1', name: 'Karsten' },
            now: '2026-03-11T08:00:00Z',
        })

        expect(result.success).toBe(true)
        expect(result.createdNote).toBe(false)
        expect(noteService.addContentToStorage).toHaveBeenCalledWith(
            'projectA',
            'note-project-a',
            '2026-03-11: [preference] Prefers short summaries\n',
            { uid: 'user1', name: 'Karsten' }
        )
    })

    test('auto-creates and links a user note when missing', async () => {
        const db = createDb({
            user1: {
                displayName: 'Karsten',
                noteIdsByProject: {},
            },
        })
        const noteService = createNoteService()

        const result = await updateUserMemory({
            db,
            projectId: 'projectA',
            requestUserId: 'user1',
            fact: 'Likes to review plans before implementation',
            noteService,
            feedUser: { uid: 'user1', name: 'Karsten' },
            now: '2026-03-11T08:00:00Z',
        })

        expect(result.createdNote).toBe(true)
        expect(noteService.createAndPersistNote).toHaveBeenCalled()
        expect(db.updates).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    userId: 'user1',
                    data: expect.objectContaining({
                        'noteIdsByProject.projectA': 'created-note-id',
                    }),
                }),
            ])
        )
        expect(noteService.addContentToStorage).toHaveBeenCalledWith(
            'projectA',
            'created-note-id',
            '2026-03-11: Likes to review plans before implementation\n',
            { uid: 'user1', name: 'Karsten' }
        )
    })

    test('skips obvious duplicate memories', async () => {
        const db = createDb({
            user1: {
                displayName: 'Karsten',
                noteIdsByProject: { projectA: 'note-project-a' },
            },
        })
        const noteService = createNoteService({
            getStorageContent: jest.fn(async () => '2026-03-10: Prefers short summaries\n'),
        })

        const result = await updateUserMemory({
            db,
            projectId: 'projectA',
            requestUserId: 'user1',
            fact: 'Prefers short summaries',
            noteService,
            feedUser: { uid: 'user1', name: 'Karsten' },
        })

        expect(result.skipped).toBe(true)
        expect(noteService.addContentToStorage).not.toHaveBeenCalled()
    })

    test('uses the project-specific user note for different assistants', async () => {
        const db = createDb({
            user1: {
                displayName: 'Karsten',
                noteIdsByProject: { projectA: 'note-a', projectB: 'note-b' },
            },
        })
        const noteService = createNoteService()

        await updateUserMemory({
            db,
            projectId: 'projectB',
            requestUserId: 'user1',
            fact: 'Works best with explicit scope',
            noteService,
            feedUser: { uid: 'user1', name: 'Karsten' },
            now: '2026-03-11T08:00:00Z',
        })

        expect(noteService.addContentToStorage).toHaveBeenCalledWith(
            'projectB',
            'note-b',
            '2026-03-11: Works best with explicit scope\n',
            { uid: 'user1', name: 'Karsten' }
        )
    })

    test('fails safely when requestUserId is missing', async () => {
        await expect(
            updateUserMemory({
                db: createDb({}),
                projectId: 'projectA',
                requestUserId: '',
                fact: 'Prefers short summaries',
                noteService: createNoteService(),
            })
        ).rejects.toThrow('update_user_memory requires requestUserId in runtime context')
    })

    test('loads project user memory into assistant context', async () => {
        const db = createDb({
            user1: {
                noteIdsByProject: { projectA: 'note-project-a' },
            },
        })
        const noteService = createNoteService({
            getStorageContent: jest.fn(async () => '# Karsten memory\n\n2026-03-11: Prefers short summaries\n'),
        })

        const result = await getUserMemoryContextMessage({
            db,
            projectId: 'projectA',
            requestUserId: 'user1',
            noteService,
        })

        expect(result).toContain('User memory for this project:')
        expect(result).toContain('Prefers short summaries')
    })
})
