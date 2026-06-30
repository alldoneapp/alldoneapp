#!/usr/bin/env node

const admin = require('../functions/node_modules/firebase-admin')
const {
    reconcileAllHeartbeatSchedules,
    syncHeartbeatSchedulesForProject,
} = require('../functions/Assistant/assistantHeartbeatSchedule')

function getArgument(name) {
    const prefix = `--${name}=`
    const argument = process.argv.find(value => value.startsWith(prefix))
    return argument ? argument.slice(prefix.length) : null
}

async function main() {
    const execute = process.argv.includes('--execute')
    const firebaseProjectId =
        getArgument('firebase-project-id') || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
    const scopeProjectId = getArgument('project-id')

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
    const dryRun = !execute
    console.log('Heartbeat schedule backfill starting', {
        firebaseProjectId,
        scopeProjectId: scopeProjectId || 'all',
        dryRun,
    })

    const result = scopeProjectId
        ? await syncHeartbeatSchedulesForProject(scopeProjectId, { db, dryRun })
        : await reconcileAllHeartbeatSchedules({ db, dryRun })

    console.log('Heartbeat schedule backfill completed', { ...result, dryRun })
    if (dryRun) console.log('No writes were made. Re-run with --execute to apply the backfill.')
}

main().catch(error => {
    console.error('Heartbeat schedule backfill failed', error)
    process.exitCode = 1
})
