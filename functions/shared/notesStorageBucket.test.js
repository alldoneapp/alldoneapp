'use strict'

/**
 * AT-2498 — the notes Storage bucket must be decided by the DEPLOYED PROJECT,
 * never by a configured value that disagrees with it.
 *
 * The regression this pins is not hypothetical. Production's
 * `GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET` became `notescontentdev` on
 * 2026-08-29 while every writer kept using `notescontentprod`. The search
 * indexer trusted the parameter, so `getNoteContent` asked a bucket in another
 * project for the note body and got `storage.objects.get denied` on every note
 * create and update — no note body reached Typesense for days, with no product
 * symptom other than search going stale.
 */

const {
    resolveNotesBucketName,
    resolveDeployedProjectId,
    getExpectedNotesBucket,
    getNotesBucketName,
    __resetMismatchWarnings,
} = require('./notesStorageBucket')

const silentLogger = () => ({ warn: jest.fn() })

describe('resolveNotesBucketName', () => {
    beforeEach(() => __resetMismatchWarnings())

    it('overrides a dev bucket configured in production — the AT-2498 regression', () => {
        const logger = silentLogger()

        expect(
            resolveNotesBucketName({
                configuredBucket: 'notescontentdev',
                projectId: 'alldonealeph',
                logger,
            })
        ).toBe('notescontentprod')
        expect(logger.warn).toHaveBeenCalledTimes(1)
        expect(logger.warn.mock.calls[0][0]).toContain('notescontentdev')
        expect(logger.warn.mock.calls[0][0]).toContain('notescontentprod')
    })

    it('overrides in the other direction too — a prod bucket configured in staging', () => {
        expect(
            resolveNotesBucketName({
                configuredBucket: 'notescontentprod',
                projectId: 'alldonestaging',
                logger: silentLogger(),
            })
        ).toBe('notescontentstaging')
    })

    it('is a no-op when the configuration already agrees, and warns about nothing', () => {
        const logger = silentLogger()

        expect(
            resolveNotesBucketName({ configuredBucket: 'notescontentprod', projectId: 'alldonealeph', logger })
        ).toBe('notescontentprod')
        expect(logger.warn).not.toHaveBeenCalled()
    })

    it('resolves the right bucket even with no configuration at all', () => {
        expect(resolveNotesBucketName({ projectId: 'alldonealeph', logger: silentLogger() })).toBe('notescontentprod')
        expect(resolveNotesBucketName({ projectId: 'alldonestaging', logger: silentLogger() })).toBe(
            'notescontentstaging'
        )
    })

    it('keeps honouring the configured bucket for an unknown project', () => {
        // Local scripts, the emulator and CI have no production identity to
        // enforce, so their configuration is still the answer. This is what makes
        // the change provably inert outside production and staging.
        const logger = silentLogger()

        expect(resolveNotesBucketName({ configuredBucket: 'local-notes', projectId: 'my-sandbox', logger })).toBe(
            'local-notes'
        )
        expect(logger.warn).not.toHaveBeenCalled()
    })

    it('falls back to the dev bucket when nothing is known', () => {
        expect(resolveNotesBucketName({ projectId: null, logger: silentLogger() })).toBe('notescontentdev')
        expect(resolveNotesBucketName({ configuredBucket: '   ', projectId: null, logger: silentLogger() })).toBe(
            'notescontentdev'
        )
    })

    it('warns once per distinct misconfiguration, not once per note', () => {
        const logger = silentLogger()
        const args = { configuredBucket: 'notescontentdev', projectId: 'alldonealeph', logger }

        for (let i = 0; i < 25; i++) resolveNotesBucketName(args)

        expect(logger.warn).toHaveBeenCalledTimes(1)
    })
})

describe('resolveDeployedProjectId', () => {
    const noAdmin = {
        app: () => {
            throw new Error('no app')
        },
    }

    it('prefers GCLOUD_PROJECT, then GCP_PROJECT', () => {
        expect(resolveDeployedProjectId({ env: { GCLOUD_PROJECT: 'a', GCP_PROJECT: 'b' }, admin: noAdmin })).toBe('a')
        expect(resolveDeployedProjectId({ env: { GCP_PROJECT: 'b' }, admin: noAdmin })).toBe('b')
    })

    it('reads FIREBASE_CONFIG when the plain env vars are absent', () => {
        expect(
            resolveDeployedProjectId({
                env: { FIREBASE_CONFIG: JSON.stringify({ projectId: 'alldonealeph' }) },
                admin: noAdmin,
            })
        ).toBe('alldonealeph')
    })

    it('falls back to the initialized admin app', () => {
        expect(
            resolveDeployedProjectId({ env: {}, admin: { app: () => ({ options: { projectId: 'alldonestaging' } }) } })
        ).toBe('alldonestaging')
    })

    it('never throws on a malformed FIREBASE_CONFIG — a note read must not die on it', () => {
        expect(resolveDeployedProjectId({ env: { FIREBASE_CONFIG: '{not json' }, admin: noAdmin })).toBeNull()
    })

    it('reports unknown rather than guessing', () => {
        expect(resolveDeployedProjectId({ env: {}, admin: noAdmin })).toBeNull()
    })
})

describe('getExpectedNotesBucket', () => {
    it('maps only the two real deployments', () => {
        expect(getExpectedNotesBucket('alldonealeph')).toBe('notescontentprod')
        expect(getExpectedNotesBucket('alldonestaging')).toBe('notescontentstaging')
        expect(getExpectedNotesBucket('anything-else')).toBeNull()
        expect(getExpectedNotesBucket(undefined)).toBeNull()
    })
})

describe('getNotesBucketName', () => {
    beforeEach(() => __resetMismatchWarnings())

    it('reads the environment variable and still enforces the deployed project', () => {
        expect(
            getNotesBucketName({
                env: { GCLOUD_PROJECT: 'alldonealeph', GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET: 'notescontentdev' },
                admin: { app: () => ({ options: {} }) },
                logger: silentLogger(),
            })
        ).toBe('notescontentprod')
    })

    it('uses the environment variable verbatim outside the known deployments', () => {
        expect(
            getNotesBucketName({
                env: { GCLOUD_PROJECT: 'sandbox', GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET: 'notescontentdev' },
                admin: { app: () => ({ options: {} }) },
                logger: silentLogger(),
            })
        ).toBe('notescontentdev')
    })
})
