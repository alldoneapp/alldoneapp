#!/usr/bin/env node

// Security audit 2026-11 (NEW-A): a scheduled assistant task now runs only content its activator
// approved (functions/Assistant/assistantTaskContentApproval.js). Activations that exist before the
// deploy carry no approval yet, so without this every one of them would stop and notify its user.
// This approves the CURRENT content for every user activated today. Run it right after deploying
// the functions (the scheduler skips unapproved runs from then on).
//
// Usage:
//   node migration/approveExistingAssistantTaskContent.js --firebase-project-id=<gcp-project-id>             (dry run)
//   node migration/approveExistingAssistantTaskContent.js --firebase-project-id=<gcp-project-id> --execute   (apply)
//
// Application Default Credentials are used (gcloud auth application-default login, or a
// service account via GOOGLE_APPLICATION_CREDENTIALS).

const admin = require('../functions/node_modules/firebase-admin')
const { buildBackfillApprovalUpdate } = require('../functions/Assistant/assistantTaskContentApproval')
const { GLOBAL_ASSISTANT_TASK_PROJECT_ID } = require('../functions/Assistant/assistantTaskContentHash')

function getArgument(name) {
    const prefix = `--${name}=`
    const argument = process.argv.find(value => value.startsWith(prefix))
    return argument ? argument.slice(prefix.length) : null
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

    const projectRefs = await db.collection('assistantTasks').listDocuments()
    console.log(
        `${dryRun ? 'DRY RUN' : 'EXECUTE'}: ${projectRefs.length} assistant task project(s) on ${firebaseProjectId}`
    )

    const stats = { tasks: 0, updatedTasks: 0, approvals: 0, global: 0 }
    for (const projectRef of projectRefs) {
        if (projectRef.id === GLOBAL_ASSISTANT_TASK_PROJECT_ID) {
            stats.global++
            continue
        }
        const collections = await projectRef.listCollections()
        for (const collection of collections) {
            const tasks = await collection.get()
            for (const taskDoc of tasks.docs) {
                stats.tasks++
                const planned = buildBackfillApprovalUpdate(taskDoc.data(), projectRef.id)
                if (!planned) continue
                stats.updatedTasks++
                stats.approvals += Object.keys(planned).length
                console.log(
                    `  ${dryRun ? 'would approve' : 'approving'}: ${taskDoc.ref.path} for ${Object.keys(planned).length} user(s)`
                )
                if (dryRun) continue
                // Re-plan inside a transaction so a concurrent edit is never approved unseen.
                await db.runTransaction(async transaction => {
                    const fresh = await transaction.get(taskDoc.ref)
                    if (!fresh.exists) return
                    const update = buildBackfillApprovalUpdate(fresh.data(), projectRef.id)
                    if (update) transaction.update(taskDoc.ref, update)
                })
            }
        }
    }

    console.log(stats)
    if (dryRun) console.log('Dry run only. Re-run with --execute to apply.')
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
