const { readThreadAssistantModelOverride } = require('./threadAssistantModelStore')
const { THREAD_ASSISTANT_MODEL_FIELD } = require('./threadAssistantModel')

// The real `getObjectDocPath` is deliberately NOT mocked: which document a thread type resolves
// to is the thing that can silently drift away from the client writer, so the test asserts the
// actual paths rather than a double's idea of them.
const makeDb = (documents = {}, { failOn } = {}) => {
    const get = jest.fn()
    return {
        get,
        doc: jest.fn(path => ({
            get: async () => {
                get(path)
                if (failOn === path) throw new Error('boom')
                const data = documents[path]
                return { exists: data !== undefined, data: () => data }
            },
        })),
    }
}

describe('reading a thread model override server-side (AT-2502)', () => {
    beforeEach(() => {
        jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    it.each([
        ['tasks', 'items/project-1/tasks/object-1'],
        ['topics', 'chatObjects/project-1/chats/object-1'],
        ['chats', 'chatObjects/project-1/chats/object-1'],
        ['notes', 'noteItems/project-1/notes/object-1'],
        ['goals', 'goals/project-1/items/object-1'],
        ['contacts', 'projectsContacts/project-1/contacts/object-1'],
        ['skills', 'skills/project-1/items/object-1'],
    ])('reads a %s thread from its own document', async (objectType, expectedPath) => {
        const db = makeDb({ [expectedPath]: { [THREAD_ASSISTANT_MODEL_FIELD]: 'MODEL_GPT5_6_LUNA' } })

        await expect(readThreadAssistantModelOverride(db, 'project-1', objectType, 'object-1')).resolves.toBe(
            'MODEL_GPT5_6_LUNA'
        )
        expect(db.doc).toHaveBeenCalledWith(expectedPath)
    })

    it('answers null for a thread that pins nothing', async () => {
        const db = makeDb({ 'items/project-1/tasks/object-1': { assistantId: 'assistant-1' } })

        await expect(readThreadAssistantModelOverride(db, 'project-1', 'tasks', 'object-1')).resolves.toBeNull()
    })

    it('answers null for a thread whose document does not exist yet', async () => {
        const db = makeDb({})

        await expect(readThreadAssistantModelOverride(db, 'project-1', 'topics', 'object-1')).resolves.toBeNull()
    })

    it('validates the stored value rather than trusting it', async () => {
        const db = makeDb({ 'items/project-1/tasks/object-1': { [THREAD_ASSISTANT_MODEL_FIELD]: 'MODEL_GPT5_5' } })

        await expect(readThreadAssistantModelOverride(db, 'project-1', 'tasks', 'object-1')).resolves.toBeNull()
    })

    // Best-effort by contract. An override is a convenience; an assistant that refuses to answer
    // because a settings read failed is an outage, so every failure has to degrade to "no pin".
    it('never throws when the read fails, and does not go silent about it', async () => {
        const db = makeDb({}, { failOn: 'items/project-1/tasks/object-1' })

        await expect(readThreadAssistantModelOverride(db, 'project-1', 'tasks', 'object-1')).resolves.toBeNull()
        expect(console.warn).toHaveBeenCalled()
    })

    it.each([
        ['a missing db', [null, 'project-1', 'tasks', 'object-1']],
        ['a missing projectId', [makeDb(), '', 'tasks', 'object-1']],
        ['a missing objectId', [makeDb(), 'project-1', 'tasks', '']],
    ])('answers null for %s without reading anything', async (_label, args) => {
        await expect(readThreadAssistantModelOverride(...args)).resolves.toBeNull()
        if (args[0]) expect(args[0].doc).not.toHaveBeenCalled()
    })

    // An object type with no document of its own cannot carry a pin. That is the ordinary answer
    // for those threads, not an error, and it must not cost a read.
    it('answers null for an object type with no thread document', async () => {
        const db = makeDb()

        await expect(readThreadAssistantModelOverride(db, 'project-1', 'somethingElse', 'object-1')).resolves.toBeNull()
        expect(db.doc).not.toHaveBeenCalled()
    })
})
