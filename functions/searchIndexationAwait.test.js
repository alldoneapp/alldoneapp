/**
 * `processObject` is async, and a builder that forgets to await it puts a
 * PROMISE into the list handed to `saveObjects`.
 *
 * Found via AT-2258. The creator backfill reindexed both goals and chats with
 * the same machinery, and the results split perfectly: chats populated 327 of
 * 337 records, goals populated 0 of 634. The only difference was that
 * `addChatsToList` awaited `processObject` and `addGoalsToList` did not — and
 * the same omission was in the tasks, contacts and assistants builders.
 *
 * It is invisible in every cheap way: the reindex reports success, the trigger
 * doc is deleted, nothing is logged, and the index keeps looking healthy
 * because the per-object create/update triggers write correct records
 * continuously. Only a bulk reindex is affected — which is exactly the path
 * nobody runs until a backfill needs it.
 *
 * So this suite asserts the property directly: after any builder runs, the
 * list must contain resolved records and never a thenable.
 */
jest.mock(
    'firebase-admin',
    () => ({
        firestore: () => ({}),
        // addNotesToList → getNoteContent reaches storage; exists:false short-circuits
        // to '' so the notes builder can run without real note content.
        storage: () => ({ bucket: () => ({ file: () => ({ exists: async () => [false] }) }) }),
    }),
    { virtual: true }
)
jest.mock('firebase-functions/params', () => ({ defineString: () => ({ value: () => 'test-bucket' }) }), {
    virtual: true,
})

const searchHelper = require('./searchHelper')

const docOf = (id, data) => ({ id, data: () => data })

// Minimal Firestore double: every query shape used by the builders resolves to
// the same doc set, which is all these assertions need.
const makeDb = docs => {
    const snapshot = {
        docs,
        forEach: callback => docs.forEach(callback),
        length: docs.length,
    }
    const query = {
        where: () => query,
        orderBy: () => query,
        get: async () => snapshot,
    }
    return { collection: () => query }
}

const GOAL = {
    name: 'Ship AT-2258',
    creatorId: 'user-1',
    progress: 50,
    lastEditionDate: Date.now(),
    isPublicFor: [0],
}
const NOTE = { title: 'Meeting notes', extendedTitle: 'Meeting notes', userId: 'user-1', isPublicFor: [0] }
const TASK = { name: 'Do the thing', userId: 'user-1', done: false, isSubtask: false, isPublicFor: [0] }
const CONTACT = { name: 'Ada', recorderUserId: 'user-1', isPublicFor: [0] }
const ASSISTANT = { name: 'Anna', isPublicFor: [0] }

const isThenable = value => !!value && typeof value.then === 'function'

describe('bulk indexation builders resolve every record before uploading', () => {
    const cases = [
        {
            name: 'addGoalsToList',
            run: objectsList =>
                searchHelper.addGoalsToList('project-1', {}, objectsList, true, makeDb([docOf('goal-1', GOAL)])),
            expectCreator: 'creatorId',
            creatorValue: 'user-1',
        },
        {
            name: 'addTasksToList',
            run: objectsList =>
                searchHelper.addTasksToList('project-1', {}, objectsList, true, makeDb([docOf('task-1', TASK)])),
            expectCreator: 'userId',
            creatorValue: 'user-1',
        },
        {
            name: 'addContactsToList',
            run: objectsList =>
                searchHelper.addContactsToList('project-1', {}, objectsList, makeDb([docOf('contact-1', CONTACT)])),
            expectCreator: 'recorderUserId',
            creatorValue: 'user-1',
        },
        {
            name: 'addAssistantsToList',
            run: objectsList =>
                searchHelper.addAssistantsToList('project-1', {}, objectsList, makeDb([docOf('a-1', ASSISTANT)])),
        },
        {
            // The notes pre-map used to call mapNoteData(objectId, baseObject) — two args
            // against a four-arg signature — so `note` was undefined and EVERY note in a
            // bulk reindex threw at `note.extendedTitle`. Found by the Typesense backfill.
            name: 'addNotesToList',
            run: objectsList =>
                searchHelper.addNotesToList('project-1', {}, objectsList, makeDb([docOf('note-1', NOTE)])),
            expectCreator: 'userId',
            creatorValue: 'user-1',
        },
    ]

    cases.forEach(({ name, run, expectCreator, creatorValue }) => {
        describe(name, () => {
            it('pushes plain records, never promises', async () => {
                const objectsList = []
                await run(objectsList)

                expect(objectsList).toHaveLength(1)
                expect(isThenable(objectsList[0])).toBe(false)
                // A promise serialises to `{}`, so objectID is the tell.
                expect(typeof objectsList[0].objectID).toBe('string')
            })

            if (expectCreator) {
                it(`carries ${expectCreator}, so the created-by-me filter can match it`, async () => {
                    const objectsList = []
                    await run(objectsList)

                    expect(objectsList[0][expectCreator]).toBe(creatorValue)
                })
            }
        })
    })
})
