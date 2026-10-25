'use strict'

/**
 * AT-2498 — the note-content download that feeds search must target the bucket
 * of the DEPLOYED project.
 *
 * This is the defect itself, not a neighbour of it. `getNoteContent` read
 * `defineString('GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET')` and trusted it. On
 * 2026-08-29 that parameter's production value became `notescontentdev` — a
 * bucket in a different Google Cloud project — while every writer
 * (`NoteService`, `noteContextHelper`, the assistant's `create_note` /
 * `update_note` handlers) kept using `notescontentprod` because they resolve the
 * bucket from the deployed project id instead.
 *
 * The result was not a degraded index but no index at all: the production
 * `firebase-adminsdk` service account has no access to that bucket, so every
 * note create and update threw `storage.objects.get denied` out of the trigger.
 * Nothing in the product surfaced it — notes saved, the assistant reported
 * success — search simply stopped seeing note bodies.
 */

jest.mock(
    'firebase-admin',
    () => {
        const download = jest.fn(() => Promise.resolve([Buffer.alloc(0)]))
        const exists = jest.fn(() => Promise.resolve([false]))
        const file = jest.fn(() => ({ exists, download }))
        const bucket = jest.fn(() => ({ file }))
        return {
            storage: jest.fn(() => ({ bucket })),
            firestore: jest.fn(() => ({})),
            __mock: { bucket, file, exists, download },
        }
    },
    { virtual: true }
)

// The parameter still holds the misconfigured value; the resolver is what must
// refuse to use it.
jest.mock('firebase-functions/params', () => ({ defineString: jest.fn(() => ({ value: () => 'notescontentdev' })) }), {
    virtual: true,
})

const admin = require('firebase-admin')
const { getNoteContent } = require('./searchHelper')
const { __resetMismatchWarnings } = require('./shared/notesStorageBucket')

const withProject = async (projectId, run) => {
    const previous = process.env.GCLOUD_PROJECT
    process.env.GCLOUD_PROJECT = projectId
    try {
        return await run()
    } finally {
        if (previous === undefined) delete process.env.GCLOUD_PROJECT
        else process.env.GCLOUD_PROJECT = previous
    }
}

describe('getNoteContent notes bucket', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        __resetMismatchWarnings()
        jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => jest.restoreAllMocks())

    it('reads the production bucket in production even when the parameter says dev', async () => {
        await withProject('alldonealeph', () => getNoteContent('project-1', 'note-1'))

        expect(admin.__mock.bucket).toHaveBeenCalledWith('notescontentprod')
        expect(admin.__mock.bucket).not.toHaveBeenCalledWith('notescontentdev')
        expect(admin.__mock.file).toHaveBeenCalledWith('notesData/project-1/note-1')
    })

    it('reads the staging bucket in staging', async () => {
        await withProject('alldonestaging', () => getNoteContent('project-1', 'note-1'))

        expect(admin.__mock.bucket).toHaveBeenCalledWith('notescontentstaging')
    })

    it('still honours the configured parameter outside the known deployments', async () => {
        await withProject('some-sandbox', () => getNoteContent('project-1', 'note-1'))

        expect(admin.__mock.bucket).toHaveBeenCalledWith('notescontentdev')
    })

    it('returns empty content for a note whose body was never stored', async () => {
        await expect(withProject('alldonealeph', () => getNoteContent('project-1', 'note-1'))).resolves.toBe('')
        expect(admin.__mock.download).not.toHaveBeenCalled()
    })
})
