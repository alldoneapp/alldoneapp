#!/usr/bin/env node

// Gives existing VM sessions the fields the Anna VM overview lists paused VMs by (AT-2916):
// `lastRequestUserId` (whose VM it is), `lastRunCorrelationId` (the run whose result the card shows)
// and `taskDone` (paused VMs are listed on open tasks only, like the task list's VM badge).
//
// New VM jobs write all three themselves when they are admitted to their thread, and the task
// trigger keeps `taskDone` in step. A session from before that shows no paused card in the overview
// until its thread runs again — at most 7 days, when idle sessions are cleaned up. Run it once after
// the Functions deploy; it never overwrites a value that is already there.
//
// Usage:
//   node migration/backfillVmSessionOverviewFields.js --firebase-project-id=<gcp-project-id>             (dry run)
//   node migration/backfillVmSessionOverviewFields.js --firebase-project-id=<gcp-project-id> --execute   (apply)
//
// Application Default Credentials are used (gcloud auth application-default login, or a
// service account via GOOGLE_APPLICATION_CREDENTIALS).

const admin = require('../functions/node_modules/firebase-admin')

function getArgument(name) {
    const prefix = `--${name}=`
    const argument = process.argv.find(value => value.startsWith(prefix))
    return argument ? argument.slice(prefix.length) : null
}

// The run a session last carried: the newest job on the thread that actually got to run.
async function findLastRun(db, projectId, objectId) {
    const snapshot = await db.collection('pendingWebhooks').where('objectId', '==', objectId).get()
    return snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(job => job.kind === 'vm_job' && job.projectId === projectId && !job.cancelledWhileQueued)
        .filter(job => job.status !== 'queued')
        .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))[0]
}

async function main() {
    const firebaseProjectId = getArgument('firebase-project-id')
    if (!firebaseProjectId) {
        console.error('Missing --firebase-project-id=<gcp-project-id>')
        process.exit(1)
    }
    const dryRun = !process.argv.includes('--execute')

    admin.initializeApp({ projectId: firebaseProjectId })
    const db = admin.firestore()

    const sessions = await db.collection('vmSessions').get()
    console.log(`${dryRun ? 'DRY RUN' : 'EXECUTE'}: ${sessions.size} VM session(s) on ${firebaseProjectId}`)

    const stats = { updated: 0, complete: 0, notATask: 0, noRun: 0 }
    for (const doc of sessions.docs) {
        const session = doc.data() || {}
        if (session.objectType !== 'tasks' || !session.projectId || !session.objectId) {
            stats.notATask++
            continue
        }
        const updates = {}
        if (typeof session.taskDone !== 'boolean') {
            const task = await db.doc(`items/${session.projectId}/tasks/${session.objectId}`).get()
            if (!task.exists) {
                stats.notATask++
                continue
            }
            updates.taskDone = (task.data() || {}).done === true
        }
        if (!session.lastRequestUserId || !session.lastRunCorrelationId) {
            const lastRun = await findLastRun(db, session.projectId, session.objectId)
            if (lastRun) {
                if (!session.lastRequestUserId && lastRun.userId) updates.lastRequestUserId = lastRun.userId
                if (!session.lastRunCorrelationId) updates.lastRunCorrelationId = lastRun.id
            } else stats.noRun++
        }
        if (!Object.keys(updates).length) {
            stats.complete++
            continue
        }
        console.log(`  ${dryRun ? 'would update' : 'updating'}: ${doc.ref.path}`, updates)
        stats.updated++
        // update(), not set({merge}): a session cleaned up in between must not come back as a stub.
        if (!dryRun) await doc.ref.update(updates).catch(error => console.warn(`  skipped ${doc.id}: ${error.message}`))
    }

    console.log(stats)
    if (dryRun) console.log('Dry run only. Re-run with --execute to apply.')
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
