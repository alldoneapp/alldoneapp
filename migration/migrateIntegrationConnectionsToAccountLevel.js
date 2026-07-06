#!/usr/bin/env node

// Migrates per-project email/calendar connections (users/{uid}.apisConnected[projectId])
// to account-level connections (users/{uid}.emailConnections / .calendarConnections),
// copying the project-keyed private docs (OAuth tokens, gmailLabeling config/state incl.
// recent audit messages, calendarProjectRouting) to connection-keyed ids.
//
// Safe + idempotent:
//   - Nothing is deleted; legacy docs stay in place for rollback (cleanup is a later step).
//   - Connection-keyed docs are never overwritten if they already exist.
//   - Old gmailLabeling configs are disabled + stamped { migratedTo } in the same pass,
//     which the scheduled scanner uses as its double-processing guard.
//   - Users whose connection maps already exist are skipped unless --force.
//
// Usage:
//   node migration/migrateIntegrationConnectionsToAccountLevel.js --firebase-project-id=<id>            (dry run)
//   node migration/migrateIntegrationConnectionsToAccountLevel.js --firebase-project-id=<id> --execute  (apply)
//   node migration/migrateIntegrationConnectionsToAccountLevel.js --firebase-project-id=<id> --user-id=<uid> --execute
//   ... --force            re-run for users whose maps already exist
//   ... --start-after-user=<uid>   resume a long run
//
// Application Default Credentials are used (gcloud auth application-default login, or a
// service account via GOOGLE_APPLICATION_CREDENTIALS).

const admin = require('../functions/node_modules/firebase-admin')

const {
    CONNECTION_SERVICE_CALENDAR,
    CONNECTION_SERVICE_EMAIL,
    buildConnectionId,
    listCalendarConnections,
    listEmailConnections,
    materializeConnectionsMap,
    resolveCalendarConnection,
    resolveEmailConnection,
} = require('../functions/Integrations/providerConnections')
const { migrateConnectionDocs } = require('../functions/Integrations/connectionDocMigration')

function getArgument(name) {
    const prefix = `--${name}=`
    const argument = process.argv.find(value => value.startsWith(prefix))
    return argument ? argument.slice(prefix.length) : null
}

function collectSourceProjectIds(userData, service, connectionId) {
    const resolver = service === CONNECTION_SERVICE_CALENDAR ? resolveCalendarConnection : resolveEmailConnection
    const apisConnected = userData.apisConnected || {}
    return Object.keys(apisConnected).filter(projectId => {
        const resolved = resolver(apisConnected[projectId] || {})
        return (
            resolved.connected &&
            resolved.emailAddress &&
            buildConnectionId(service, resolved.provider, resolved.emailAddress) === connectionId
        )
    })
}

async function migrateUser(db, userId, userData, { dryRun, force }) {
    const stats = {
        migrated: false,
        skippedReason: null,
        emailConnections: 0,
        calendarConnections: 0,
        docsCopied: { tokens: 0, labelingConfigs: 0, labelingStates: 0, auditMessages: 0, routingConfigs: 0 },
    }

    const hasNewMaps =
        Object.keys(userData.emailConnections || {}).length > 0 ||
        Object.keys(userData.calendarConnections || {}).length > 0
    if (hasNewMaps && !force) {
        stats.skippedReason = 'already-migrated'
        return stats
    }

    // The list resolvers synthesize account-level connections from apisConnected
    // (grouping the same account across projects; the legacy default flag wins the
    // defaultProjectId) — exactly the migration semantics.
    const emailConnections = listEmailConnections(userData)
    const calendarConnections = listCalendarConnections(userData)
    stats.emailConnections = emailConnections.length
    stats.calendarConnections = calendarConnections.length

    if (emailConnections.length === 0 && calendarConnections.length === 0) {
        stats.skippedReason = 'no-connections'
        return stats
    }

    for (const connection of [...emailConnections, ...calendarConnections]) {
        const sourceProjectIds = collectSourceProjectIds(userData, connection.service, connection.connectionId)
        console.log(`  ${connection.connectionId}`, {
            provider: connection.provider,
            emailAddress: connection.emailAddress,
            defaultProjectId: connection.defaultProjectId,
            isDefaultAccount: connection.isDefaultAccount,
            sourceProjectIds,
        })
        if (dryRun) continue

        const copied = await migrateConnectionDocs(userId, connection, sourceProjectIds)
        stats.docsCopied.tokens += copied.tokenCopied ? 1 : 0
        stats.docsCopied.labelingConfigs += copied.labelingConfigCopied ? 1 : 0
        stats.docsCopied.labelingStates += copied.labelingStateCopied ? 1 : 0
        stats.docsCopied.auditMessages += copied.auditMessagesCopied
        stats.docsCopied.routingConfigs += copied.routingConfigCopied ? 1 : 0
    }

    if (!dryRun) {
        const updateData = {}
        if (emailConnections.length > 0) {
            updateData.emailConnections = materializeConnectionsMap(CONNECTION_SERVICE_EMAIL, userData)
        }
        if (calendarConnections.length > 0) {
            updateData.calendarConnections = materializeConnectionsMap(CONNECTION_SERVICE_CALENDAR, userData)
        }
        await db.doc(`users/${userId}`).update(updateData)
        stats.migrated = true
    }

    return stats
}

async function main() {
    const execute = process.argv.includes('--execute')
    const force = process.argv.includes('--force')
    const dryRun = !execute
    const firebaseProjectId =
        getArgument('firebase-project-id') || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT
    const scopeUserId = getArgument('user-id')

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
    console.log('Integration connection migration starting', {
        firebaseProjectId,
        scope: scopeUserId ? `user:${scopeUserId}` : 'all-users',
        dryRun,
        force,
    })

    const totals = {
        users: 0,
        migrated: 0,
        alreadyMigrated: 0,
        noConnections: 0,
        docsCopied: { tokens: 0, labelingConfigs: 0, labelingStates: 0, auditMessages: 0, routingConfigs: 0 },
    }

    const accumulate = stats => {
        totals.users++
        if (stats.migrated) totals.migrated++
        if (stats.skippedReason === 'already-migrated') totals.alreadyMigrated++
        if (stats.skippedReason === 'no-connections') totals.noConnections++
        Object.keys(totals.docsCopied).forEach(key => {
            totals.docsCopied[key] += stats.docsCopied[key]
        })
    }

    const processUser = async userDoc => {
        const userData = userDoc.data() || {}
        const hasAnyLegacyConnection = Object.keys(userData.apisConnected || {}).length > 0
        const hasNewMaps =
            Object.keys(userData.emailConnections || {}).length > 0 ||
            Object.keys(userData.calendarConnections || {}).length > 0
        if (!hasAnyLegacyConnection && !hasNewMaps) return
        console.log(`User ${userDoc.id}:`)
        accumulate(await migrateUser(db, userDoc.id, userData, { dryRun, force }))
    }

    if (scopeUserId) {
        const userDoc = await db.doc(`users/${scopeUserId}`).get()
        if (!userDoc.exists) throw new Error(`User ${scopeUserId} not found`)
        await processUser(userDoc)
    } else {
        const pageSize = 200
        const startAfterUser = getArgument('start-after-user')
        let cursorId = startAfterUser || null
        // eslint-disable-next-line no-constant-condition
        while (true) {
            let query = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize)
            if (cursorId) query = query.startAfter(cursorId)

            const snapshot = await query.get()
            if (snapshot.empty) break

            for (const userDoc of snapshot.docs) {
                await processUser(userDoc)
            }

            cursorId = snapshot.docs[snapshot.docs.length - 1].id
            if (snapshot.size < pageSize) break
        }
    }

    console.log('Integration connection migration finished', { ...totals, dryRun })
}

main().catch(error => {
    console.error('Migration failed:', error)
    process.exit(1)
})
