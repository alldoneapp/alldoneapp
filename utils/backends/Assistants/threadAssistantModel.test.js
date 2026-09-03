import {
    canOverrideThreadAssistantModel,
    getThreadAssistantModelDocPath,
    readThreadAssistantModelOverride,
    setThreadAssistantModelOverride,
} from './threadAssistantModel'
import { THREAD_ASSISTANT_MODEL_FIELD } from '../../../functions/Assistant/threadAssistantModel'

const mockDocs = new Map()
const mockUpdate = jest.fn()
const mockDoc = jest.fn(path => ({
    get: jest.fn(async () => {
        const data = mockDocs.get(path)
        return { exists: data !== undefined, data: () => data }
    }),
    update: jest.fn(payload => mockUpdate(path, payload)),
}))

jest.mock('../firestore', () => ({ getDb: () => ({ doc: mockDoc }) }))
jest.mock('../offlineWriteAck', () => ({ awaitWriteAck: write => write }))
jest.mock('firebase/compat/app', () => ({ default: { firestore: { FieldValue: { delete: () => '<<delete>>' } } } }), {
    virtual: true,
})

describe('storing a thread model override on the client (AT-2502)', () => {
    beforeEach(() => {
        mockDocs.clear()
        jest.clearAllMocks()
        jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => jest.restoreAllMocks())

    // The write and the Cloud Functions read must address the SAME document. They share
    // `getObjectDocPath`, and this is the assertion that keeps that true.
    describe('the document a thread writes to', () => {
        it.each([
            ['tasks', 'items/project-1/tasks/object-1'],
            ['task', 'items/project-1/tasks/object-1'],
            ['topics', 'chatObjects/project-1/chats/object-1'],
            ['chats', 'chatObjects/project-1/chats/object-1'],
            ['notes', 'noteItems/project-1/notes/object-1'],
            ['goals', 'goals/project-1/items/object-1'],
            ['contacts', 'projectsContacts/project-1/contacts/object-1'],
            ['users', 'users/object-1'],
            ['skills', 'skills/project-1/items/object-1'],
        ])('maps %s threads to %s', (objectType, expected) => {
            expect(getThreadAssistantModelDocPath('project-1', 'object-1', objectType)).toBe(expected)
            expect(canOverrideThreadAssistantModel('project-1', 'object-1', objectType)).toBe(true)
        })

        // An assistant's own board is the one thread where "the thread's model" and "the
        // assistant's model" are the same question, and the two sides disagree about which
        // document an assistant is — so a pin there would be written and never read back.
        it.each(['assistants', 'assistant', 'projects', 'somethingElse'])('refuses to pin a %s thread', objectType => {
            expect(getThreadAssistantModelDocPath('project-1', 'object-1', objectType)).toBeNull()
            expect(canOverrideThreadAssistantModel('project-1', 'object-1', objectType)).toBe(false)
        })
    })

    describe('writing', () => {
        it('pins a selectable model on the thread document', async () => {
            await expect(
                setThreadAssistantModelOverride('project-1', 'object-1', 'tasks', 'MODEL_GPT5_6_TERRA')
            ).resolves.toBe('MODEL_GPT5_6_TERRA')

            expect(mockUpdate).toHaveBeenCalledWith('items/project-1/tasks/object-1', {
                [THREAD_ASSISTANT_MODEL_FIELD]: 'MODEL_GPT5_6_TERRA',
            })
        })

        // Clearing removes the field instead of writing null, so a thread that follows its
        // assistant is indistinguishable from one that was never pinned.
        it('removes the field when the user picks the assistant default', async () => {
            await expect(
                setThreadAssistantModelOverride('project-1', 'object-1', 'topics', 'INHERIT_ASSISTANT_MODEL')
            ).resolves.toBeNull()

            expect(mockUpdate).toHaveBeenCalledWith('chatObjects/project-1/chats/object-1', {
                [THREAD_ASSISTANT_MODEL_FIELD]: '<<delete>>',
            })
        })

        it('never stores a model the reader would refuse', async () => {
            await expect(
                setThreadAssistantModelOverride('project-1', 'object-1', 'tasks', 'MODEL_GPT5_5')
            ).resolves.toBeNull()

            expect(mockUpdate).toHaveBeenCalledWith('items/project-1/tasks/object-1', {
                [THREAD_ASSISTANT_MODEL_FIELD]: '<<delete>>',
            })
        })

        it('writes nothing for a thread type that cannot be pinned', async () => {
            await expect(
                setThreadAssistantModelOverride('project-1', 'object-1', 'assistants', 'MODEL_GPT5_6_SOL')
            ).resolves.toBeNull()

            expect(mockDoc).not.toHaveBeenCalled()
        })

        // A thread whose document does not exist yet (a brand-new topic) rejects the update. That
        // must not surface as a crash in a popup the user is closing.
        it('swallows a failed write', async () => {
            mockUpdate.mockImplementationOnce(() => Promise.reject(new Error('no document')))

            await expect(
                setThreadAssistantModelOverride('project-1', 'object-1', 'tasks', 'MODEL_GPT5_6_SOL')
            ).resolves.toBe('MODEL_GPT5_6_SOL')
            expect(console.warn).toHaveBeenCalled()
        })

        // A settings choice is not content. Stamping edition data would make every other open
        // client re-download a note and would write an activity feed entry for picking a model.
        it('writes only the override field, with no edition data', async () => {
            await setThreadAssistantModelOverride('project-1', 'object-1', 'notes', 'MODEL_GPT5_6_LUNA')

            const [, payload] = mockUpdate.mock.calls[0]
            expect(Object.keys(payload)).toEqual([THREAD_ASSISTANT_MODEL_FIELD])
        })
    })

    describe('reading', () => {
        it('returns the pinned model', async () => {
            mockDocs.set('items/project-1/tasks/object-1', { [THREAD_ASSISTANT_MODEL_FIELD]: 'MODEL_GPT5_6_LUNA' })

            await expect(readThreadAssistantModelOverride('project-1', 'object-1', 'tasks')).resolves.toBe(
                'MODEL_GPT5_6_LUNA'
            )
        })

        it('returns null for an unpinned or missing thread', async () => {
            mockDocs.set('items/project-1/tasks/object-1', {})

            await expect(readThreadAssistantModelOverride('project-1', 'object-1', 'tasks')).resolves.toBeNull()
            await expect(readThreadAssistantModelOverride('project-1', 'missing', 'tasks')).resolves.toBeNull()
        })

        it('returns null without reading for a thread type that cannot be pinned', async () => {
            await expect(readThreadAssistantModelOverride('project-1', 'object-1', 'assistants')).resolves.toBeNull()
            expect(mockDoc).not.toHaveBeenCalled()
        })
    })
})
