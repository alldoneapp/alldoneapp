#!/usr/bin/env node

// Removes project ids from users/{uid} membership lists (projectIds, guideProjectIds,
// templateProjectIds, archivedProjectIds, copyProjectIds) that projects/{pid}.userIds does not back.
// A missing project document counts as unbacked. (security audit 2026-11)
//
// projects/{pid}.userIds is the only membership authority. Until the 2026-11 rules fix, the
// `invitation-remove` membership mutation let any account add an arbitrary project id to its own
// lists, and the users read rule still trusts overlapping projectIds. Run this after the
// firestore.rules deploy that closes that branch. The decision is the pure
// planUnbackedProjectIdRemovals in functions/shared/userProjectMembershipCleanup.js.
//
// Usage:
//   node migration/removeUnbackedUserProjectIds.js --firebase-project-id=<gcp-project-id>                      (dry run)
//   node migration/removeUnbackedUserProjectIds.js --firebase-project-id=<gcp-project-id> --user-id=<uid>      (one user)
//   node migration/removeUnbackedUserProjectIds.js --firebase-project-id=<gcp-project-id> --execute            (apply)
//
// Output is one line per removal (uid, list, project id) plus a summary; no other user data.
// Application Default Credentials are used (gcloud auth application-default login, or a
// service account via GOOGLE_APPLICATION_CREDENTIALS).

const {
    collectListedProjectIds,
    planUnbackedProjectIdRemovals,
} = require('../functions/shared/userProjectMembershipCleanup')

const USER_PAGE_SIZE = 300

function getArgument(name) {
    const prefix = `--${name}=`
    const argument = process.argv.find(value => value.startsWith(prefix))
    return argument ? argument.slice(prefix.length) : null
}

// projects/{pid}.userIds per id, cached across users (null when the project does not exist).
function createProjectUserIdsLoader(db) {
    const cache = new Map()
    return async projectIds => {
        const missing = projectIds.filter(id => !cache.has(id))
        for (let start = 0; start < missing.length; start += 100) {
            const refs = missing.slice(start, start + 100).map(id => db.doc(`projects/${id}`))
            const snapshots = await db.getAll(...refs)
            snapshots.forEach(snapshot => {
                const userIds = snapshot.exists ? snapshot.data()?.userIds : null
                cache.set(snapshot.id, Array.isArray(userIds) ? userIds : null)
            })
        }
        return new Map(projectIds.map(id => [id, cache.get(id)]))
    }
}

async function processUser(db, userDoc, loadProjectUserIds, dryRun, stats) {
    stats.usersScanned++
    const userData = userDoc.data() || {}
    const projectUserIds = await loadProjectUserIds(collectListedProjectIds(userData))
    const { removals, update } = planUnbackedProjectIdRemovals(userDoc.id, userData, projectUserIds)
    if (removals.length === 0) return

    removals.forEach(({ list, projectId }) => {
        console.log(`  ${dryRun ? 'would remove' : 'removing'}: ${userDoc.id} ${list} ${projectId}`)
    })
    stats.usersChanged++
    stats.removals += removals.length
    // Only the membership lists are written; nothing else on the user document changes.
    if (!dryRun) await userDoc.ref.update(update)
}

async function main() {
    const firebaseProjectId = getArgument('firebase-project-id')
    if (!firebaseProjectId) {
        console.error('Missing --firebase-project-id=<gcp-project-id>')
        process.exit(1)
    }
    const userId = getArgument('user-id')
    const dryRun = !process.argv.includes('--execute')

    const admin = require('../functions/node_modules/firebase-admin')
    admin.initializeApp({ projectId: firebaseProjectId })
    const db = admin.firestore()
    const loadProjectUserIds = createProjectUserIdsLoader(db)

    console.log(
        `${dryRun ? 'DRY RUN' : 'EXECUTE'}: unbacked user project ids on ${firebaseProjectId}${
            userId ? ` (user ${userId})` : ''
        }`
    )
    const stats = { usersScanned: 0, usersChanged: 0, removals: 0 }

    if (userId) {
        const userDoc = await db.doc(`users/${userId}`).get()
        if (!userDoc.exists) {
            console.error(`User ${userId} not found`)
            process.exit(1)
        }
        await processUser(db, userDoc, loadProjectUserIds, dryRun, stats)
    } else {
        const { FieldPath } = require('../functions/node_modules/firebase-admin/firestore')
        let lastDoc = null
        for (;;) {
            let query = db.collection('users').orderBy(FieldPath.documentId()).limit(USER_PAGE_SIZE)
            if (lastDoc) query = query.startAfter(lastDoc)
            const page = await query.get()
            if (page.empty) break
            for (const userDoc of page.docs) {
                await processUser(db, userDoc, loadProjectUserIds, dryRun, stats)
            }
            lastDoc = page.docs[page.docs.length - 1]
        }
    }

    console.log(stats)
    if (dryRun) console.log('Dry run only. Re-run with --execute to apply.')
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
