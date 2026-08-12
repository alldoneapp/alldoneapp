#!/usr/bin/env node

// Phase 2 of the Algolia → Typesense migration (TYPESENSE_MIGRATION.md): imports ALL
// historical content — every project, no 30-day windows, templates and dormant projects
// included — into Typesense. Writes ONLY to Typesense plus a `typesenseBackfill/{projectId}`
// progress marker; Algolia is never touched, so its billable record count stays flat.
//
// Resumable and idempotent: imports are upserts, and a project with a `completedAt` marker
// is skipped on re-run (pass --force to redo). A project that partially fails records its
// failing object types and is retried by the next run.
//
// Run this AFTER the Phase 1 dual-write is deployed, so edits made during/after the
// backfill flow into Typesense on their own.
//
// Usage:
//   TYPESENSE_HOST=xxx.a1.typesense.net \
//   TYPESENSE_ADMIN_API_KEY=... \
//   GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET=<see envs/env.master or env.develop> \
//   GOOGLE_APPLICATION_CREDENTIALS=serv_account_key_master.json \
//   node migration/backfillTypesense.js --firebase-project-id=<gcp-project-id>            (dry run)
//   node migration/backfillTypesense.js --firebase-project-id=<gcp-project-id> --execute  (apply)
//
// Optional flags:
//   --project-id=<alldoneProjectId>   scope to one project
//   --start-after-project=<id>        resume the project cursor past a given id
//   --concurrency=N                   projects processed in parallel (default 1)
//   --force                           reprocess projects already marked complete
//   --stats                           print live Typesense collection counts and exit
//
// Note: the dry run performs the same Firestore/Storage reads as a real run (it builds the
// full record lists to count them) — it only skips the Typesense writes and progress marks.

const admin = require('../functions/node_modules/firebase-admin')

const TASKS_OBJECTS_TYPE = 'tasks'
const GOALS_OBJECTS_TYPE = 'goals'
const NOTES_OBJECTS_TYPE = 'notes'
const CONTACTS_OBJECTS_TYPE = 'contacts'
const ASSISTANTS_OBJECTS_TYPE = 'assistants'
const USERS_OBJECTS_TYPE = 'users'
const CHATS_OBJECTS_TYPE = 'chats'

function getArgument(name) {
    const prefix = `--${name}=`
    const argument = process.argv.find(value => value.startsWith(prefix))
    return argument ? argument.slice(prefix.length) : null
}

// Builds the full (no 30-day window) record list for one object type of one project.
const buildRecordsForType = async (objectsType, projectId, usersMap, db) => {
    const searchHelper = require('../functions/searchHelper')
    const records = []
    if (objectsType === TASKS_OBJECTS_TYPE) {
        await searchHelper.addTasksToList(projectId, usersMap, records, /* activeFullSearch */ true, db)
    } else if (objectsType === GOALS_OBJECTS_TYPE) {
        await searchHelper.addGoalsToList(projectId, usersMap, records, /* activeFullSearch */ true, db)
    } else if (objectsType === NOTES_OBJECTS_TYPE) {
        await searchHelper.addNotesToList(projectId, usersMap, records, db)
    } else if (objectsType === CHATS_OBJECTS_TYPE) {
        await searchHelper.addChatsToList(projectId, {}, records, /* activeFullSearch */ true, db)
    } else if (objectsType === CONTACTS_OBJECTS_TYPE) {
        await searchHelper.addContactsToList(projectId, {}, records, db)
    } else if (objectsType === ASSISTANTS_OBJECTS_TYPE) {
        await searchHelper.addAssistantsToList(projectId, {}, records, db)
    } else if (objectsType === USERS_OBJECTS_TYPE) {
        records.push(...(await searchHelper.buildProjectUsersSearchRecords(projectId)))
    }
    return records
}

const processProject = async (db, projectId, objectTypes, { dryRun, force }) => {
    const { getIndexName } = require('../functions/searchHelper')
    const { importTypesenseDocuments } = require('../functions/typesenseHelper')
    const { mapUsersInProject } = require('../functions/Firestore/generalFirestoreCloud')

    const stats = { projectId, records: 0, imported: 0, failedRecords: 0, failedTypes: [], skipped: false }

    const progressRef = db.doc(`typesenseBackfill/${projectId}`)
    if (!force) {
        const progressDoc = await progressRef.get()
        if (progressDoc.exists && progressDoc.data().completedAt) {
            stats.skipped = true
            return stats
        }
    }

    const usersMap = {}
    if (objectTypes.some(type => type === TASKS_OBJECTS_TYPE || type === GOALS_OBJECTS_TYPE)) {
        await mapUsersInProject(projectId, db, usersMap)
    }

    const counts = {}
    for (const objectsType of objectTypes) {
        try {
            const records = await buildRecordsForType(objectsType, projectId, usersMap, db)
            counts[objectsType] = records.length
            stats.records += records.length
            if (!dryRun && records.length > 0) {
                const { imported, failed } = await importTypesenseDocuments(getIndexName(objectsType), records)
                stats.imported += imported
                stats.failedRecords += failed
                if (failed > 0) stats.failedTypes.push({ type: objectsType, error: `${failed} records rejected` })
            }
        } catch (error) {
            stats.failedTypes.push({ type: objectsType, error: error.message })
        }
    }

    if (!dryRun) {
        const progressData = {
            counts,
            lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
        }
        if (stats.failedTypes.length === 0 && stats.failedRecords === 0) {
            progressData.completedAt = admin.firestore.FieldValue.serverTimestamp()
        } else {
            progressData.failures = stats.failedTypes
        }
        await progressRef.set(progressData, { merge: true })
    }

    return stats
}

async function main() {
    const execute = process.argv.includes('--execute')
    const statsOnly = process.argv.includes('--stats')
    const force = process.argv.includes('--force')
    const dryRun = !execute
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

    const { isTypesenseConfigured, getTypesenseCollectionStats } = require('../functions/typesenseHelper')

    if (statsOnly) {
        console.log('Typesense collection stats:', await getTypesenseCollectionStats())
        return
    }

    // With Typesense unconfigured every write is a silent no-op — an --execute run would
    // "succeed", mark every project complete, and import nothing. Refuse instead.
    if (execute && !isTypesenseConfigured()) {
        throw new Error('TYPESENSE_HOST / TYPESENSE_ADMIN_API_KEY are not set. Refusing to run with --execute.')
    }
    if (!process.env.GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET) {
        throw new Error(
            'GOOGLE_FIREBASE_WEB_NOTES_STORAGE_BUCKET is not set — note contents could not be read. ' +
                'Take the value from envs/env.master (production) or envs/env.develop (staging).'
        )
    }

    const db = admin.firestore()
    const projectObjectTypes = [
        TASKS_OBJECTS_TYPE,
        GOALS_OBJECTS_TYPE,
        NOTES_OBJECTS_TYPE,
        CHATS_OBJECTS_TYPE,
        CONTACTS_OBJECTS_TYPE,
        ASSISTANTS_OBJECTS_TYPE,
        USERS_OBJECTS_TYPE,
    ]

    console.log('Typesense backfill starting', {
        firebaseProjectId,
        scope: scopeProjectId ? `project:${scopeProjectId}` : 'all-projects',
        dryRun,
        force,
    })

    const totals = { projects: 0, skipped: 0, records: 0, imported: 0, failedRecords: 0, failedProjects: [] }

    const accumulate = projectStats => {
        totals.projects++
        if (projectStats.skipped) {
            totals.skipped++
            return
        }
        totals.records += projectStats.records
        totals.imported += projectStats.imported
        totals.failedRecords += projectStats.failedRecords
        if (projectStats.failedTypes.length > 0) {
            totals.failedProjects.push({ projectId: projectStats.projectId, failures: projectStats.failedTypes })
        }
        console.log(`  project ${projectStats.projectId}`, {
            records: projectStats.records,
            imported: projectStats.imported,
            failed: projectStats.failedRecords,
            failedTypes: projectStats.failedTypes,
        })
    }

    if (scopeProjectId) {
        accumulate(await processProject(db, scopeProjectId, projectObjectTypes, { dryRun, force }))
    } else {
        const pageSize = 200
        const concurrency = Number(getArgument('concurrency')) || 1
        let cursorId = getArgument('start-after-project') || null
        // eslint-disable-next-line no-constant-condition
        while (true) {
            let query = db.collection('projects').orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize)
            if (cursorId) query = query.startAfter(cursorId)

            const snapshot = await query.get()
            if (snapshot.empty) break

            for (let i = 0; i < snapshot.docs.length; i += concurrency) {
                const batch = snapshot.docs.slice(i, i + concurrency)
                const batchStats = await Promise.all(
                    batch.map(projectDoc => processProject(db, projectDoc.id, projectObjectTypes, { dryRun, force }))
                )
                batchStats.forEach(accumulate)
            }

            cursorId = snapshot.docs[snapshot.docs.length - 1].id
            if (snapshot.size < pageSize) break
        }

        // Global assistants live under GLOBAL_PROJECT_ID, outside the projects collection.
        const { GLOBAL_PROJECT_ID } = require('../functions/Firestore/assistantsFirestore')
        accumulate(await processProject(db, GLOBAL_PROJECT_ID, [ASSISTANTS_OBJECTS_TYPE], { dryRun, force }))
    }

    console.log('Typesense backfill completed', {
        projects: totals.projects,
        skipped: totals.skipped,
        records: totals.records,
        imported: totals.imported,
        failedRecords: totals.failedRecords,
        failedProjects: totals.failedProjects.length,
        dryRun,
    })
    if (totals.failedProjects.length > 0) {
        console.log('Projects with failures (will be retried on the next run):', totals.failedProjects)
    }
    if (dryRun) {
        console.log(
            `No writes were made. ${totals.records} record(s) would be imported. Re-run with --execute to apply.`
        )
    } else {
        console.log('Typesense collection stats:', await getTypesenseCollectionStats())
    }
}

main().catch(error => {
    console.error('Typesense backfill failed', error)
    process.exitCode = 1
})
