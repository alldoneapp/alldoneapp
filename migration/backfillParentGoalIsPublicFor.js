#!/usr/bin/env node

// Repairs tasks that point at a goal (`parentGoalId`) but carry no `parentGoalIsPublicFor`
// array. The open-task lists group a task under its goal only when that array names the
// reader, so such a task is silently filed under "no goal" while still belonging to one, and
// the client warns `[OpenTasks] oldTask.parentGoalIsPublicFor missing/invalid` on its next
// edit. The producer was the server-side recurrence copy (functions/Tasks/recurringTasksCloud.js
// through TaskModelBuilder, which hardcoded the field to null); the builder is fixed, this
// script fixes what it already wrote.
//
// Each affected task gets its goal's current `isPublicFor` (public-for-all when the goal
// document has none, the same default mapGoalData applies). A task whose goal document no
// longer exists is reported and left untouched.
//
// Usage:
//   node migration/backfillParentGoalIsPublicFor.js --firebase-project-id=<gcp-project-id>              (dry run)
//   node migration/backfillParentGoalIsPublicFor.js --firebase-project-id=<gcp-project-id> --execute    (apply)
//   node migration/backfillParentGoalIsPublicFor.js --firebase-project-id=<gcp-project-id> --project-id=<alldone project id> --execute
//
// Application Default Credentials are used (gcloud auth application-default login, or a
// service account via GOOGLE_APPLICATION_CREDENTIALS).

const admin = require('../functions/node_modules/firebase-admin')

const FEED_PUBLIC_FOR_ALL = 0
const BATCH_SIZE = 400

function getArgument(name) {
    const prefix = `--${name}=`
    const argument = process.argv.find(value => value.startsWith(prefix))
    return argument ? argument.slice(prefix.length) : null
}

async function repairProject(db, projectId, { dryRun, stats }) {
    const snapshot = await db.collection(`items/${projectId}/tasks`).where('parentGoalIsPublicFor', '==', null).get()

    const affected = snapshot.docs.filter(doc => !!(doc.data() || {}).parentGoalId)
    if (affected.length === 0) return

    const goalPrivacyById = new Map()
    const resolveGoalPrivacy = async goalId => {
        if (goalPrivacyById.has(goalId)) return goalPrivacyById.get(goalId)
        const goalDoc = await db.doc(`goals/${projectId}/items/${goalId}`).get()
        const privacy = goalDoc.exists
            ? Array.isArray(goalDoc.data().isPublicFor) && goalDoc.data().isPublicFor.length > 0
                ? goalDoc.data().isPublicFor
                : [FEED_PUBLIC_FOR_ALL]
            : null
        goalPrivacyById.set(goalId, privacy)
        return privacy
    }

    let batch = db.batch()
    let pending = 0
    const flush = async () => {
        if (pending === 0) return
        if (!dryRun) await batch.commit()
        batch = db.batch()
        pending = 0
    }

    for (const doc of affected) {
        stats.affected++
        const { parentGoalId } = doc.data()
        const privacy = await resolveGoalPrivacy(parentGoalId)
        if (!privacy) {
            stats.goalMissing++
            console.log(`  goal missing, left untouched: items/${projectId}/tasks/${doc.id} -> ${parentGoalId}`)
            continue
        }
        batch.update(doc.ref, { parentGoalIsPublicFor: privacy })
        pending++
        stats.repaired++
        if (pending >= BATCH_SIZE) await flush()
    }
    await flush()
    console.log(`${projectId}: ${affected.length} affected, ${stats.repaired} repaired so far`)
}

async function main() {
    const firebaseProjectId = getArgument('firebase-project-id')
    if (!firebaseProjectId) {
        console.error('Missing --firebase-project-id=<gcp-project-id>')
        process.exit(1)
    }
    const dryRun = !process.argv.includes('--execute')
    const onlyProjectId = getArgument('project-id')

    admin.initializeApp({ projectId: firebaseProjectId })
    const db = admin.firestore()

    const projectIds = onlyProjectId
        ? [onlyProjectId]
        : (await db.collection('projects').select().get()).docs.map(doc => doc.id)

    console.log(`${dryRun ? 'DRY RUN' : 'EXECUTE'}: scanning ${projectIds.length} project(s) on ${firebaseProjectId}`)

    const stats = { projects: projectIds.length, affected: 0, repaired: 0, goalMissing: 0 }
    for (const projectId of projectIds) {
        try {
            await repairProject(db, projectId, { dryRun, stats })
        } catch (error) {
            console.error(`${projectId}: failed`, error.message)
        }
    }

    console.log(
        `${dryRun ? 'Would repair' : 'Repaired'} ${stats.repaired} task(s) across ${stats.projects} project(s); ` +
            `${stats.affected} affected, ${stats.goalMissing} pointing at a missing goal (untouched).`
    )
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
