#!/usr/bin/env node

// Populates the server-owned access fields used by Firestore Security Rules,
// including the per-reader backlink projection. Run after deploying the
// projection triggers and before publishing rules or a client that queries them.
//
// Usage:
//   node migration/backfillFirestoreAccessProjections.js --firebase-project-id=alldonestaging
//   node migration/backfillFirestoreAccessProjections.js --firebase-project-id=alldonestaging --execute
//   node migration/backfillFirestoreAccessProjections.js --firebase-project-id=alldonestaging --project-id=<id> --execute
//
// The default is a read-only dry run. Application Default Credentials are used.

'use strict'

const admin = require('../functions/node_modules/firebase-admin')
const {
    getInitialProjectionCursor,
    synchronizeProjectAccessProjectionPage,
} = require('../functions/shared/objectAccessProjection')

function getArgument(name) {
    const prefix = `--${name}=`
    const argument = process.argv.find(value => value.startsWith(prefix))
    return argument ? argument.slice(prefix.length) : null
}

async function processProject(db, projectDoc, execute) {
    const projectId = projectDoc.id
    const projectUserIds = Array.isArray(projectDoc.data()?.userIds) ? projectDoc.data().userIds : []
    const stats = { scanned: 0, changed: 0 }
    let cursor = getInitialProjectionCursor()
    let page = 0
    while (cursor) {
        const result = await synchronizeProjectAccessProjectionPage(db, projectId, projectUserIds, cursor, 400, execute)
        page++
        stats.scanned += result.scanned
        stats.changed += result.updated
        cursor = result.cursor
        if (page % 25 === 0) console.log(`  ${projectId} progress`, { page, ...stats })
    }
    return stats
}

async function main() {
    const firebaseProjectId =
        getArgument('firebase-project-id') || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
    const scopeProjectId = getArgument('project-id')
    const startAfterProjectId = getArgument('start-after-project-id')
    const execute = process.argv.includes('--execute')

    if (!firebaseProjectId) {
        throw new Error('Pass --firebase-project-id=<gcp-project-id>. Application Default Credentials are used.')
    }
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.applicationDefault(),
            projectId: firebaseProjectId,
        })
    }

    const db = admin.firestore()
    const totals = { projects: 0, scanned: 0, changed: 0 }
    console.log('Firestore access projection backfill starting', {
        firebaseProjectId,
        projectId: scopeProjectId || 'all',
        startAfterProjectId: startAfterProjectId || null,
        execute,
    })

    const processAndReport = async projectDoc => {
        const stats = await processProject(db, projectDoc, execute)
        totals.projects++
        totals.scanned += stats.scanned
        totals.changed += stats.changed
        if (stats.changed > 0) console.log(`  ${projectDoc.id}`, stats)
    }

    if (scopeProjectId) {
        const projectDoc = await db.doc(`projects/${scopeProjectId}`).get()
        if (!projectDoc.exists) throw new Error(`Project not found: ${scopeProjectId}`)
        await processAndReport(projectDoc)
    } else {
        const pageSize = 100
        let cursor = startAfterProjectId
        // eslint-disable-next-line no-constant-condition
        while (true) {
            let query = db.collection('projects').orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize)
            if (cursor) query = query.startAfter(cursor)
            const snapshot = await query.get()
            if (snapshot.empty) break
            for (const projectDoc of snapshot.docs) await processAndReport(projectDoc)
            cursor = snapshot.docs[snapshot.docs.length - 1].id
            if (snapshot.size < pageSize) break
        }
    }

    console.log('Firestore access projection backfill completed', { ...totals, execute })
    if (!execute) console.log('No writes were made. Re-run with --execute after reviewing the counts.')
}

main().catch(error => {
    console.error('Firestore access projection backfill failed', error)
    process.exitCode = 1
})
