#!/usr/bin/env node

// One-time migration for security audit NV-17 (see functions/Assistant/heartbeatOptIn.js).
//
// After NV-17 a heartbeat runs for a member only after that member confirmed the assistant's current
// heartbeat configuration (the server confirms for a project's only member whenever the
// configuration changes from now on). This script confirms it, with the configuration as it is
// stored now, for:
//   --scope=owner (default)  the only member of a one-member project, and in a shared project the
//                            assistant's creator (creatorId), when still a member;
//   --scope=all              every member a heartbeat reaches today (the old behaviour).
// Existing confirmations are kept. Run it right before the functions deploy (the old code ignores
// the field, so nobody loses a heartbeat in between) and once more right after it; it is idempotent.
//
// Dry run by default: pass --execute to write. --project-id=<id> limits it to one project.
//
//   node migration/confirmAssistantHeartbeats.js --firebase-project-id=alldonealeph
//   node migration/confirmAssistantHeartbeats.js --firebase-project-id=alldonealeph --scope=all --execute

const admin = require('../functions/node_modules/firebase-admin')
const { MIGRATION_SCOPES, planHeartbeatConfirmations } = require('../functions/Assistant/heartbeatOptInMigrationPlan')

function getArgument(name) {
    const prefix = `--${name}=`
    const argument = process.argv.find(value => value.startsWith(prefix))
    return argument ? argument.slice(prefix.length) : null
}

async function loadUsers(db, userIds) {
    const usersById = new Map()
    const refs = userIds.map(userId => db.doc(`users/${userId}`))
    for (let index = 0; index < refs.length; index += 100) {
        const docs = await db.getAll(...refs.slice(index, index + 100))
        docs.filter(doc => doc.exists).forEach(doc => usersById.set(doc.id, doc.data() || {}))
    }
    return usersById
}

async function main() {
    const execute = process.argv.includes('--execute')
    const scope = getArgument('scope') || 'owner'
    const firebaseProjectId =
        getArgument('firebase-project-id') || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
    const scopeProjectId = getArgument('project-id')

    if (!MIGRATION_SCOPES.includes(scope)) throw new Error(`--scope must be one of ${MIGRATION_SCOPES.join(', ')}`)
    if (!firebaseProjectId) {
        throw new Error(
            'Pass --firebase-project-id=<gcp-project-id> or set GCLOUD_PROJECT/GCP_PROJECT. Application Default Credentials are used.'
        )
    }
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: firebaseProjectId })
    }

    const db = admin.firestore()
    const now = Date.now()
    console.log('Heartbeat confirmation migration starting', {
        firebaseProjectId,
        scope,
        scopeProjectId: scopeProjectId || 'all',
        dryRun: !execute,
    })

    const projectDocs = scopeProjectId
        ? [await db.doc(`projects/${scopeProjectId}`).get()].filter(doc => doc.exists)
        : (await db.collection('projects').get()).docs

    let planned = 0
    for (const projectDoc of projectDocs) {
        const projectId = projectDoc.id
        const project = { ...projectDoc.data(), id: projectId }
        const memberIds = Array.isArray(project.userIds) ? [...new Set(project.userIds.filter(Boolean))] : []
        if (!memberIds.length) continue
        const assistantsSnapshot = await db.collection(`assistants/${projectId}/items`).get()
        if (assistantsSnapshot.empty) continue
        const assistants = assistantsSnapshot.docs.map(doc => ({ ...doc.data(), uid: doc.id }))
        const usersById = await loadUsers(db, memberIds)
        const plan = planHeartbeatConfirmations({ projectId, project, assistants, usersById, scope, now })

        for (const entry of plan) {
            planned++
            console.log(execute ? 'Confirming' : 'Would confirm', {
                projectId: entry.projectId,
                assistantId: entry.assistantId,
                userId: entry.userId,
            })
            if (execute) await db.doc(`users/${entry.userId}`).update({ [entry.fieldPath]: entry.record })
        }
    }

    console.log('Heartbeat confirmation migration completed', { planned, dryRun: !execute })
    if (!execute) console.log('No writes were made. Re-run with --execute to apply.')
}

if (require.main === module) {
    main().catch(error => {
        console.error('Heartbeat confirmation migration failed', error)
        process.exitCode = 1
    })
}
