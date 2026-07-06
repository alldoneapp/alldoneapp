#!/usr/bin/env node

// Deletes the legacy "Emails in inbox" summary tasks that the retired email
// pipeline created (functions/apis/EmailIntegration.js). Those tasks carry
// `isForEmail: true` and a `gmailData` blob but are NOT Gmail label follow-up
// tasks. After the Email line shipped, the old task-list bucket that rendered
// them was removed, so they linger invisibly — this cleans them up.
//
// gmail_label_follow_up tasks are normal tasks (not isForEmail) and are left
// untouched; we also guard on gmailData.origin just in case.
//
// Usage:
//   node migration/cleanupInboxSummaryEmailTasks.js --firebase-project-id=<gcp-project-id>            (dry run)
//   node migration/cleanupInboxSummaryEmailTasks.js --firebase-project-id=<gcp-project-id> --execute  (apply)
//
// Application Default Credentials are used (gcloud auth application-default login, or a
// service account via GOOGLE_APPLICATION_CREDENTIALS).

const admin = require('../functions/node_modules/firebase-admin')

function getArgument(name) {
    const prefix = `--${name}=`
    const argument = process.argv.find(value => value.startsWith(prefix))
    return argument ? argument.slice(prefix.length) : null
}

function isInboxSummaryEmailTask(data = {}) {
    if (!data.isForEmail) return false
    const gmailData = data.gmailData
    if (!gmailData) return false
    if (gmailData.origin === 'gmail_label_follow_up') return false
    return true
}

async function main() {
    const execute = process.argv.includes('--execute')
    const dryRun = !execute
    const firebaseProjectId =
        getArgument('firebase-project-id') || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT

    if (!firebaseProjectId) {
        throw new Error(
            'Pass --firebase-project-id=<gcp-project-id> or set GCLOUD_PROJECT/GCP_PROJECT. Application Default Credentials are used.'
        )
    }

    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.applicationDefault(),
            projectId: firebaseProjectId,
        })
    }

    const db = admin.firestore()
    console.log('Inbox-summary email task cleanup starting', { firebaseProjectId, dryRun })

    const totals = { scanned: 0, matched: 0, deleted: 0 }
    const pageSize = 300
    let lastDoc = null

    // A collection-group query over every project's tasks. Single-field equality
    // on isForEmail uses the automatic collection-group index.
    // eslint-disable-next-line no-constant-condition
    while (true) {
        let query = db
            .collectionGroup('tasks')
            .where('isForEmail', '==', true)
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(pageSize)
        if (lastDoc) query = query.startAfter(lastDoc)

        const snapshot = await query.get()
        if (snapshot.empty) break

        let batch = db.batch()
        let batchCount = 0

        for (const doc of snapshot.docs) {
            totals.scanned++
            const data = doc.data() || {}
            if (!isInboxSummaryEmailTask(data)) continue
            totals.matched++

            if (dryRun) continue

            batch.delete(doc.ref)
            batchCount++
            totals.deleted++
            if (batchCount >= 400) {
                await batch.commit()
                batch = db.batch()
                batchCount = 0
            }
        }

        if (!dryRun && batchCount > 0) await batch.commit()

        lastDoc = snapshot.docs[snapshot.docs.length - 1]
        if (snapshot.size < pageSize) break
    }

    console.log('Inbox-summary email task cleanup completed', { ...totals, dryRun })
    if (dryRun) {
        console.log(`No writes were made. ${totals.matched} task(s) would be deleted. Re-run with --execute to apply.`)
    }
}

main().catch(error => {
    console.error('Inbox-summary email task cleanup failed', error)
    process.exitCode = 1
})
