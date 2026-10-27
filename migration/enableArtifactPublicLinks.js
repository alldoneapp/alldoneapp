#!/usr/bin/env node

// Gives existing artifacts the public link new artifacts get on creation
// (functions/Artifacts/artifactStore.js, commitArtifactVersion).
//
// Only artifacts that never had one are touched: the `publicLink` field is missing. An artifact
// whose link somebody switched off carries `publicLink: null` and stays off, and a private artifact
// gets none, exactly as on creation. No history entry is written: like on creation, the link is the
// default, not something a member did.
//
// Run after the functions that serve public links are deployed, or the new links answer 404.
//
// Usage:
//   node migration/enableArtifactPublicLinks.js --firebase-project-id=<gcp-project-id>             (dry run)
//   node migration/enableArtifactPublicLinks.js --firebase-project-id=<gcp-project-id> --execute   (apply)
//
// Application Default Credentials are used (gcloud auth application-default login, or a
// service account via GOOGLE_APPLICATION_CREDENTIALS).

const admin = require('../functions/node_modules/firebase-admin')
const { generatePublicLinkToken } = require('../functions/Artifacts/artifactStore')
const {
    ARTIFACT_ITEMS_COLLECTION,
    ARTIFACTS_SUBCOLLECTION,
    getArtifactPublicLinkDocPath,
} = require('../functions/Artifacts/artifactModel')

function getArgument(name) {
    const prefix = `--${name}=`
    const argument = process.argv.find(value => value.startsWith(prefix))
    return argument ? argument.slice(prefix.length) : null
}

function needsPublicLink(artifact) {
    return artifact.publicLink === undefined && artifact.isPrivate !== true
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

    // `artifactItems/{projectId}` parents are not documents themselves, so list them. A collection
    // group query on `artifacts` would also match chat comments and followers of artifacts.
    const parents = await db.collection(ARTIFACT_ITEMS_COLLECTION).listDocuments()
    console.log(`${dryRun ? 'DRY RUN' : 'EXECUTE'}: scanning ${parents.length} project(s) on ${firebaseProjectId}`)

    const stats = { artifacts: 0, enabled: 0, skippedPrivate: 0, skippedDecided: 0 }
    for (const parent of parents) {
        const snapshot = await parent.collection(ARTIFACTS_SUBCOLLECTION).get()
        for (const doc of snapshot.docs) {
            stats.artifacts++
            const artifact = doc.data() || {}
            if (artifact.publicLink !== undefined) {
                stats.skippedDecided++
                continue
            }
            if (artifact.isPrivate === true) {
                stats.skippedPrivate++
                continue
            }
            console.log(`  ${dryRun ? 'would enable' : 'enabling'}: ${doc.ref.path} (${artifact.title || 'untitled'})`)
            stats.enabled++
            if (dryRun) continue

            await db.runTransaction(async transaction => {
                const latest = await transaction.get(doc.ref)
                if (!latest.exists || !needsPublicLink(latest.data() || {})) return
                const now = Date.now()
                const token = generatePublicLinkToken()
                transaction.set(db.doc(getArtifactPublicLinkDocPath(token)), {
                    projectId: parent.id,
                    artifactId: doc.id,
                    created: now,
                })
                transaction.update(doc.ref, {
                    publicLink: { token, createdAt: now, createdBy: (latest.data() || {}).userId || '' },
                })
            })
        }
    }

    console.log(JSON.stringify(stats, null, 2))
    if (dryRun) console.log('Dry run only. Re-run with --execute to apply.')
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
