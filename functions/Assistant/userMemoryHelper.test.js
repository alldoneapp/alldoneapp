const {
    ASSISTANT_MEMORY_COLLECTION,
    AssistantMemoryAccessError,
    USER_MEMORY_STORED_MAX_CHARS,
    buildAssistantMemoryDocId,
    buildUserMemoryEntry,
    getAssistantMemoryForViewer,
    getUserMemoryContextMessage,
    isDuplicateUserMemory,
    updateOwnAssistantMemory,
    updateUserMemory,
} = require('./userMemoryHelper')

// In-memory Firestore double: a flat map of "collection/doc" -> data. Any read of a collection
// other than projects/assistantMemories fails the test, which is what pins that the memory is
// never read from (or written to) a user's profile note any more.
function createDb(initial = {}) {
    const store = new Map(Object.entries(initial))
    const touched = []
    const makeDocRef = (collectionName, id) => {
        const path = `${collectionName}/${id}`
        return {
            path,
            get: jest.fn(async () => ({ exists: store.has(path), data: () => store.get(path) })),
            set: jest.fn(async (data, options) => {
                const current = options && options.merge ? store.get(path) || {} : {}
                store.set(path, { ...current, ...data })
            }),
        }
    }
    const db = {
        store,
        touched,
        collection: jest.fn(name => {
            touched.push(name)
            if (name !== 'projects' && name !== ASSISTANT_MEMORY_COLLECTION) {
                throw new Error(`Unexpected collection ${name}`)
            }
            return { doc: id => makeDocRef(name, id) }
        }),
        runTransaction: jest.fn(async work => {
            const pendingWrites = []
            const transaction = {
                get: ref => ref.get(),
                set: (ref, data, options) => pendingWrites.push(() => ref.set(data, options)),
            }
            const result = await work(transaction)
            for (const write of pendingWrites) await write()
            return result
        }),
    }
    return db
}

const memoryPath = (userId, projectId) =>
    `${ASSISTANT_MEMORY_COLLECTION}/${buildAssistantMemoryDocId(userId, projectId)}`

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

    test('saves memory into the private server-only store, never into a note', async () => {
        const db = createDb()

        const result = await updateUserMemory({
            db,
            projectId: 'projectA',
            requestUserId: 'user1',
            fact: 'Prefers short summaries',
            category: 'preference',
            now: '2026-03-11T08:00:00Z',
        })

        expect(result).toMatchObject({ success: true, skipped: false, projectId: 'projectA' })
        expect(result.noteId).toBeUndefined()
        expect(db.store.get(memoryPath('user1', 'projectA'))).toMatchObject({
            userId: 'user1',
            projectId: 'projectA',
            content: '2026-03-11: [preference] Prefers short summaries\n',
            updatedBy: 'assistant',
        })
        expect(db.touched).not.toContain('users')
        expect(db.touched).not.toContain('noteItems')
    })

    test('appends to existing memory and keeps projects apart', async () => {
        const db = createDb({
            [memoryPath('user1', 'projectB')]: { content: '2026-03-10: Old fact' },
        })

        await updateUserMemory({
            db,
            projectId: 'projectB',
            requestUserId: 'user1',
            fact: 'Works best with explicit scope',
            now: '2026-03-11T08:00:00Z',
        })

        expect(db.store.get(memoryPath('user1', 'projectB')).content).toBe(
            '2026-03-10: Old fact\n2026-03-11: Works best with explicit scope\n'
        )
        expect(db.store.has(memoryPath('user1', 'projectA'))).toBe(false)
    })

    test('skips obvious duplicate memories', async () => {
        const db = createDb({
            [memoryPath('user1', 'projectA')]: { content: '2026-03-10: Prefers short summaries\n' },
        })

        const result = await updateUserMemory({
            db,
            projectId: 'projectA',
            requestUserId: 'user1',
            fact: 'Prefers short summaries',
        })

        expect(result.skipped).toBe(true)
        expect(db.store.get(memoryPath('user1', 'projectA')).content).toBe('2026-03-10: Prefers short summaries\n')
    })

    test('drops the oldest lines when the stored memory outgrows its cap', async () => {
        const oldLine = '2026-01-01: very old\n'
        const db = createDb({
            [memoryPath('user1', 'projectA')]: { content: oldLine + 'y'.repeat(USER_MEMORY_STORED_MAX_CHARS - 5) },
        })

        await updateUserMemory({
            db,
            projectId: 'projectA',
            requestUserId: 'user1',
            fact: 'Newest fact',
            now: '2026-03-11T08:00:00Z',
        })

        const content = db.store.get(memoryPath('user1', 'projectA')).content
        expect(content.length).toBeLessThanOrEqual(USER_MEMORY_STORED_MAX_CHARS)
        expect(content).not.toContain('very old')
        expect(content.endsWith('2026-03-11: Newest fact\n')).toBe(true)
    })

    test('fails safely when requestUserId is missing', async () => {
        await expect(
            updateUserMemory({
                db: createDb(),
                projectId: 'projectA',
                requestUserId: '',
                fact: 'Prefers short summaries',
            })
        ).rejects.toThrow('update_user_memory requires requestUserId in runtime context')
    })

    test('loads only the private memory into assistant context', async () => {
        const db = createDb({
            [memoryPath('user1', 'projectA')]: { content: '2026-03-11: Prefers short summaries\n' },
        })

        const result = await getUserMemoryContextMessage({ db, projectId: 'projectA', requestUserId: 'user1' })

        expect(result).toBe('User memory for this project:\n2026-03-11: Prefers short summaries')
        // The profile note (users/{uid}.noteIdsByProject) is never consulted: a teammate can edit
        // that note, so its text must never become system context for this user's runs.
        expect(db.touched).toEqual([ASSISTANT_MEMORY_COLLECTION])
    })

    test('returns no context when the user has no private memory', async () => {
        const db = createDb()
        await expect(getUserMemoryContextMessage({ db, projectId: 'projectA', requestUserId: 'user1' })).resolves.toBe(
            ''
        )
    })

    test('keeps the newest 10000 characters of a long memory', async () => {
        const db = createDb({
            [memoryPath('user1', 'projectA')]: { content: 'a'.repeat(1000) + 'x'.repeat(10000) },
        })

        const result = await getUserMemoryContextMessage({ db, projectId: 'projectA', requestUserId: 'user1' })

        const contextContent = result.replace('User memory for this project:\n', '')
        expect(contextContent).toBe(`...${'x'.repeat(10000)}`)
    })
})

describe('assistant memory access (callables)', () => {
    const project = { 'projects/projectA': { userIds: ['owner', 'teammate'] } }

    test('the owner reads and edits their own memory', async () => {
        const db = createDb({ ...project, [memoryPath('owner', 'projectA')]: { content: 'secret fact' } })

        await expect(
            getAssistantMemoryForViewer({ db, projectId: 'projectA', userId: 'owner', viewerId: 'owner' })
        ).resolves.toMatchObject({
            isOwner: true,
            visible: true,
            content: 'secret fact',
            shareWithProjectMembers: false,
        })

        const updated = await updateOwnAssistantMemory({
            db,
            projectId: 'projectA',
            userId: 'owner',
            content: 'edited',
            shareWithProjectMembers: true,
        })
        expect(updated).toMatchObject({ content: 'edited', shareWithProjectMembers: true })
        expect(db.store.get(memoryPath('owner', 'projectA')).updatedBy).toBe('user')
    })

    test('a teammate sees nothing while the memory is private', async () => {
        const db = createDb({ ...project, [memoryPath('owner', 'projectA')]: { content: 'secret fact' } })

        await expect(
            getAssistantMemoryForViewer({ db, projectId: 'projectA', userId: 'owner', viewerId: 'teammate' })
        ).resolves.toEqual({ isOwner: false, visible: false, content: '', shareWithProjectMembers: false })
    })

    test('a teammate reads a shared memory, read-only', async () => {
        const db = createDb({
            ...project,
            [memoryPath('owner', 'projectA')]: { content: 'shared fact', shareWithProjectMembers: true },
        })

        await expect(
            getAssistantMemoryForViewer({ db, projectId: 'projectA', userId: 'owner', viewerId: 'teammate' })
        ).resolves.toEqual({ isOwner: false, visible: true, content: 'shared fact', shareWithProjectMembers: true })
    })

    test('a non-member is refused even for a shared memory', async () => {
        const db = createDb({
            ...project,
            [memoryPath('owner', 'projectA')]: { content: 'shared fact', shareWithProjectMembers: true },
        })

        await expect(
            getAssistantMemoryForViewer({ db, projectId: 'projectA', userId: 'owner', viewerId: 'outsider' })
        ).rejects.toBeInstanceOf(AssistantMemoryAccessError)
    })

    test('nobody can write somebody else memory: the write always targets the caller', async () => {
        const db = createDb({ ...project, [memoryPath('owner', 'projectA')]: { content: 'owner fact' } })

        await updateOwnAssistantMemory({ db, projectId: 'projectA', userId: 'teammate', content: 'planted' })

        expect(db.store.get(memoryPath('owner', 'projectA')).content).toBe('owner fact')
        expect(db.store.get(memoryPath('teammate', 'projectA')).content).toBe('planted')
    })

    test('rejects bad input', async () => {
        const db = createDb(project)
        await expect(
            updateOwnAssistantMemory({ db, projectId: 'projectA', userId: 'owner', shareWithProjectMembers: 'yes' })
        ).rejects.toThrow('shareWithProjectMembers must be true or false.')
        await expect(updateOwnAssistantMemory({ db, projectId: 'projectA', userId: 'owner' })).rejects.toThrow(
            'Nothing to change.'
        )
        await expect(
            updateOwnAssistantMemory({ db, projectId: 'projectA', userId: 'outsider', content: 'x' })
        ).rejects.toThrow('You are not a member of this project.')
    })
})
