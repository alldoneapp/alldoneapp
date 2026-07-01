#!/usr/bin/env node

// Backfills the consent-independent gold rollups (goldStats/daily, goldStats/monthly)
// from existing users/{uid}/goldTransactions entries.
//
// Safe to run alongside the live aggregateGoldTransactionStats trigger: each ledger
// entry is aggregated exactly once, guarded by an `aggregatedAt` stamp on the source
// doc. Re-running only processes entries that were not yet aggregated.
//
// Usage:
//   node migration/backfillGoldStats.js --firebase-project-id=<gcp-project-id>            (dry run)
//   node migration/backfillGoldStats.js --firebase-project-id=<gcp-project-id> --execute  (apply)
//   node migration/backfillGoldStats.js --firebase-project-id=<gcp-project-id> --user-id=<uid> --execute
//
// Application Default Credentials are used (gcloud auth application-default login, or a
// service account via GOOGLE_APPLICATION_CREDENTIALS).

const admin = require('../functions/node_modules/firebase-admin')

function getArgument(name) {
    const prefix = `--${name}=`
    const argument = process.argv.find(value => value.startsWith(prefix))
    return argument ? argument.slice(prefix.length) : null
}

async function processUserTransactions(db, userId, { dryRun }) {
    const { computeStatsDeltas, recordGoldTransactionStats } = require('../functions/Gold/goldStatsAggregator')

    const stats = { scanned: 0, applied: 0, alreadyAggregated: 0, skipped: 0 }
    const pageSize = 400
    let lastDoc = null

    // Paginate by document id to avoid loading a huge subcollection into memory.
    // eslint-disable-next-line no-constant-condition
    while (true) {
        let query = db
            .collection(`users/${userId}/goldTransactions`)
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(pageSize)
        if (lastDoc) query = query.startAfter(lastDoc.id)

        const snapshot = await query.get()
        if (snapshot.empty) break

        for (const doc of snapshot.docs) {
            stats.scanned++
            const data = doc.data() || {}

            if (data.aggregatedAt) {
                stats.alreadyAggregated++
                continue
            }

            if (!computeStatsDeltas(data)) {
                stats.skipped++
                continue
            }

            if (dryRun) {
                stats.applied++
                continue
            }

            const result = await recordGoldTransactionStats({
                ref: doc.ref,
                data,
                eventTime: undefined,
            })
            if (result.applied) stats.applied++
            else if (result.reason === 'already-aggregated') stats.alreadyAggregated++
            else stats.skipped++
        }

        lastDoc = snapshot.docs[snapshot.docs.length - 1]
        if (snapshot.size < pageSize) break
    }

    return stats
}

async function main() {
    const execute = process.argv.includes('--execute')
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
    console.log('Gold stats backfill starting', {
        firebaseProjectId,
        scope: scopeUserId ? `user:${scopeUserId}` : 'all-users',
        dryRun,
    })

    const totals = { users: 0, scanned: 0, applied: 0, alreadyAggregated: 0, skipped: 0 }

    const accumulate = userStats => {
        totals.users++
        totals.scanned += userStats.scanned
        totals.applied += userStats.applied
        totals.alreadyAggregated += userStats.alreadyAggregated
        totals.skipped += userStats.skipped
    }

    if (scopeUserId) {
        accumulate(await processUserTransactions(db, scopeUserId, { dryRun }))
    } else {
        const pageSize = 200
        // Process users concurrently to keep the backfill fast enough to finish in
        // one run. Per-transaction writes stay transactional + idempotent, so any
        // contention on the shared daily/monthly rollup docs is resolved by the
        // admin SDK's automatic transaction retries.
        const concurrency = Number(getArgument('concurrency')) || 12
        let lastUser = null
        // eslint-disable-next-line no-constant-condition
        while (true) {
            let query = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize)
            if (lastUser) query = query.startAfter(lastUser.id)

            const snapshot = await query.get()
            if (snapshot.empty) break

            for (let i = 0; i < snapshot.docs.length; i += concurrency) {
                const batch = snapshot.docs.slice(i, i + concurrency)
                const batchStats = await Promise.all(
                    batch.map(userDoc => processUserTransactions(db, userDoc.id, { dryRun }))
                )
                batchStats.forEach((userStats, idx) => {
                    accumulate(userStats)
                    if (userStats.scanned > 0) {
                        console.log(`  user ${batch[idx].id}`, userStats)
                    }
                })
            }

            lastUser = snapshot.docs[snapshot.docs.length - 1]
            if (snapshot.size < pageSize) break
        }
    }

    console.log('Gold stats backfill completed', { ...totals, dryRun })
    if (dryRun) {
        console.log(
            `No writes were made. ${totals.applied} transaction(s) would be aggregated. Re-run with --execute to apply.`
        )
    }
}

main().catch(error => {
    console.error('Gold stats backfill failed', error)
    process.exitCode = 1
})
