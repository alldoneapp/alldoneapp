#!/usr/bin/env node

// Marks every task that already has a VM session document with `hasVmSession: true`
// (functions/Assistant/vmTaskSessionMarker.js, AT-2907).
//
// New VM jobs set the marker themselves when they are admitted to their thread. The task list only
// watches `vmSessions/{projectId}__{taskId}` for marked tasks, so a session that existed before the
// marker shipped shows no VM badge until this has run. Run it right after the deploy.
//
// Usage:
//   node migration/backfillTaskVmSessionMarker.js --firebase-project-id=<gcp-project-id>             (dry run)
//   node migration/backfillTaskVmSessionMarker.js --firebase-project-id=<gcp-project-id> --execute   (apply)
//
// Application Default Credentials are used (gcloud auth application-default login, or a
// service account via GOOGLE_APPLICATION_CREDENTIALS).

const admin = require('../functions/node_modules/firebase-admin')
const { markTaskHasVmSession, TASK_VM_SESSION_FIELD } = require('../functions/Assistant/vmTaskSessionMarker')

function getArgument(name) {
    const prefix = `--${name}=`
    const argument = process.argv.find(value => value.startsWith(prefix))
    return argument ? argument.slice(prefix.length) : null
}

// The document id is `${projectId}__${objectId}`; the runner also stores both as fields.
function resolveSessionTarget(doc) {
    const data = doc.data() || {}
    if (typeof data.projectId === 'string' && typeof data.objectId === 'string') {
        return { projectId: data.projectId, objectId: data.objectId }
    }
    const separator = doc.id.indexOf('__')
    if (separator <= 0) return null
    return { projectId: doc.id.slice(0, separator), objectId: doc.id.slice(separator + 2) }
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

    const stats = { marked: 0, alreadyMarked: 0, notATask: 0 }
    for (const doc of sessions.docs) {
        const target = resolveSessionTarget(doc)
        const task = target ? await db.doc(`items/${target.projectId}/tasks/${target.objectId}`).get() : null
        if (!task || !task.exists) {
            stats.notATask++
            continue
        }
        if ((task.data() || {})[TASK_VM_SESSION_FIELD] === true) {
            stats.alreadyMarked++
            continue
        }
        console.log(`  ${dryRun ? 'would mark' : 'marking'}: ${task.ref.path}`)
        stats.marked++
        if (!dryRun) await markTaskHasVmSession({ ...target, objectType: 'tasks', db })
    }

    console.log(stats)
    if (dryRun) console.log('Dry run only. Re-run with --execute to apply.')
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
