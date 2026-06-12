'use strict'

const { NoteService } = require('./NoteService')

describe('NoteService.getBucketName', () => {
    const originalProject = process.env.GCLOUD_PROJECT
    const originalGcpProject = process.env.GCP_PROJECT
    const originalFirebaseConfig = process.env.FIREBASE_CONFIG
    const originalBucket = process.env.GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET

    afterEach(() => {
        restoreEnv('GCLOUD_PROJECT', originalProject)
        restoreEnv('GCP_PROJECT', originalGcpProject)
        restoreEnv('FIREBASE_CONFIG', originalFirebaseConfig)
        restoreEnv('GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET', originalBucket)
    })

    it('uses the production bucket even when the environment contains a staging bucket', async () => {
        process.env.GCLOUD_PROJECT = 'alldonealeph'
        process.env.GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET = 'notescontentdev'

        await expect(new NoteService().getBucketName()).resolves.toBe('notescontentprod')
    })

    it('honors a bucket explicitly selected by a project-aware caller', async () => {
        delete process.env.GCLOUD_PROJECT
        delete process.env.GCP_PROJECT
        delete process.env.FIREBASE_CONFIG
        process.env.GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET = 'notescontentdev'

        const service = new NoteService({
            storageBucket: 'notescontentprod',
            authoritativeStorageBucket: true,
        })
        await expect(service.getBucketName()).resolves.toBe('notescontentprod')
    })

    it('uses the staging bucket for the staging Firebase project', async () => {
        process.env.GCLOUD_PROJECT = 'alldonestaging'
        process.env.GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET = 'notescontentdev'

        await expect(new NoteService().getBucketName()).resolves.toBe('notescontentstaging')
    })

    it('keeps the development fallback for unknown local projects', async () => {
        process.env.GCLOUD_PROJECT = 'local-project'

        await expect(new NoteService({ storageBucket: 'local-notes' }).getBucketName()).resolves.toBe('notescontentdev')
    })
})

function restoreEnv(name, value) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
}
