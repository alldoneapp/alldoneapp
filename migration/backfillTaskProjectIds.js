#!/usr/bin/env node

// Stamps each items/{projectId}/tasks/{taskId} document with its authoritative
// projectId. The default mode is a read-only dry run. The migration is
// idempotent and resumes at project boundaries with --start-after-project-id.
//
// Usage:
//   node migration/backfillTaskProjectIds.js --firebase-project-id=alldonestaging
//   node migration/backfillTaskProjectIds.js --firebase-project-id=alldonestaging --execute
//   node migration/backfillTaskProjectIds.js --firebase-project-id=alldonestaging --project-id=<id> --execute
//   node migration/backfillTaskProjectIds.js --firebase-project-id=alldonestaging --project-concurrency=4
//   node migration/backfillTaskProjectIds.js --firebase-project-id=alldonestaging --verbose
//   node migration/backfillTaskProjectIds.js --firebase-project-id=alldonestaging --execute --write-delay-ms=250

'use strict'

const admin = require('../functions/node_modules/firebase-admin')

function getArgument(name) {
    const prefix = `--${name}=`
    const argument = process.argv.find(value => value.startsWith(prefix))
    return argument ? argument.slice(prefix.length) : null
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function processProject(db, projectId, execute, pageSize, writeDelayMs) {
    const stats = { scanned: 0, changed: 0 }
    let cursor = null

    // A project can have more than one batch of tasks. Re-reading the current
    // project after an interruption is safe because correct documents are skipped.
    // eslint-disable-next-line no-constant-condition
    while (true) {
        let query = db
            .collection(`items/${projectId}/tasks`)
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(pageSize)
        if (cursor) query = query.startAfter(cursor)

        const snapshot = await query.get()
        if (snapshot.empty) break

        const changedDocs = snapshot.docs.filter(documentSnapshot => documentSnapshot.data()?.projectId !== projectId)
        stats.scanned += snapshot.size
        stats.changed += changedDocs.length

        if (execute && changedDocs.length > 0) {
            const batch = db.batch()
            changedDocs.forEach(documentSnapshot => batch.set(documentSnapshot.ref, { projectId }, { merge: true }))
            await batch.commit()
            if (writeDelayMs > 0) await wait(writeDelayMs)
        }

        cursor = snapshot.docs[snapshot.docs.length - 1].id
        if (snapshot.size < pageSize) break
    }

    return stats
}

async function processWithConcurrency(items, concurrency, processItem) {
    let nextIndex = 0
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (nextIndex < items.length) {
            const item = items[nextIndex++]
            await processItem(item)
        }
    })
    await Promise.all(workers)
}

async function main() {
    const firebaseProjectId =
        getArgument('firebase-project-id') || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
    const scopeProjectId = getArgument('project-id')
    const startAfterProjectId = getArgument('start-after-project-id')
    const projectConcurrency = Number(getArgument('project-concurrency') || 1)
    const pageSize = Number(getArgument('page-size') || 400)
    const writeDelayMs = Number(getArgument('write-delay-ms') || 0)
    const execute = process.argv.includes('--execute')
    const verbose = process.argv.includes('--verbose')

    if (!firebaseProjectId) {
        throw new Error('Pass --firebase-project-id=<gcp-project-id>. Application Default Credentials are used.')
    }
    if (!Number.isInteger(projectConcurrency) || projectConcurrency < 1 || projectConcurrency > 25) {
        throw new Error('Pass --project-concurrency=<integer> between 1 and 25.')
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) {
        throw new Error('Pass --page-size=<integer> between 1 and 500.')
    }
    if (!Number.isInteger(writeDelayMs) || writeDelayMs < 0 || writeDelayMs > 10000) {
        throw new Error('Pass --write-delay-ms=<integer> between 0 and 10000.')
    }
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.applicationDefault(),
            projectId: firebaseProjectId,
        })
    }

    const db = admin.firestore()
    const totals = { projects: 0, scanned: 0, changed: 0 }
    console.log('Task projectId backfill starting', {
        firebaseProjectId,
        projectId: scopeProjectId || 'all',
        startAfterProjectId: startAfterProjectId || null,
        projectConcurrency,
        pageSize,
        writeDelayMs,
        execute,
        verbose,
    })

    const processAndReport = async projectDoc => {
        const stats = await processProject(db, projectDoc.id, execute, pageSize, writeDelayMs)
        totals.projects++
        totals.scanned += stats.scanned
        totals.changed += stats.changed
        if (verbose && stats.changed > 0) console.log(`  ${projectDoc.id}`, stats)
    }

    if (scopeProjectId) {
        const projectDoc = await db.doc(`projects/${scopeProjectId}`).get()
        if (!projectDoc.exists) throw new Error(`Project not found: ${scopeProjectId}`)
        await processAndReport(projectDoc)
    } else {
        const projectPageSize = 100
        let cursor = startAfterProjectId
        // eslint-disable-next-line no-constant-condition
        while (true) {
            let query = db.collection('projects').orderBy(admin.firestore.FieldPath.documentId()).limit(projectPageSize)
            if (cursor) query = query.startAfter(cursor)
            const snapshot = await query.get()
            if (snapshot.empty) break

            await processWithConcurrency(snapshot.docs, projectConcurrency, processAndReport)
            cursor = snapshot.docs[snapshot.docs.length - 1].id
            console.log('Task projectId backfill progress', { ...totals, lastProjectId: cursor })
            if (snapshot.size < projectPageSize) break
        }
    }

    console.log('Task projectId backfill completed', { ...totals, execute })
    if (!execute) console.log('No writes were made. Re-run with --execute after reviewing the counts.')
}

main().catch(error => {
    console.error('Task projectId backfill failed', error)
    process.exitCode = 1
})
