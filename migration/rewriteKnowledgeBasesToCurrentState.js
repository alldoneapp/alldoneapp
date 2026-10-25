#!/usr/bin/env node

// Asks every enabled project wiki for a one-time pass that rewrites its existing pages to the
// current state (no meeting history, no options a decision has settled). The pass itself runs in the
// ingest worker after its rebuilds, a few pages per run and billed to the wiki's owner like any other
// run; see functions/KnowledgeBase/knowledgeCurrentStateRewrite.js. This only stores the list of
// pages and makes each wiki due now, so deploy runKnowledgeBaseIngest first.
//
// A wiki that still has a pass pending is left alone unless --force is given; a disabled wiki is
// never touched.
//
// Usage:
//   node migration/rewriteKnowledgeBasesToCurrentState.js --firebase-project-id=<gcp-project-id>                       (dry run)
//   node migration/rewriteKnowledgeBasesToCurrentState.js --firebase-project-id=<gcp-project-id> --execute
//   node migration/rewriteKnowledgeBasesToCurrentState.js --firebase-project-id=<gcp-project-id> --project-id=<id> --execute
//
// Application Default Credentials are used (gcloud auth application-default login, or a
// service account via GOOGLE_APPLICATION_CREDENTIALS).

const admin = require('../functions/node_modules/firebase-admin')

const { KNOWLEDGE_BASES_COLLECTION } = require('../functions/KnowledgeBase/knowledgeBaseModel')
const { requestCurrentStateRewrite } = require('../functions/KnowledgeBase/knowledgeCurrentStateRewrite')

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
    const force = process.argv.includes('--force')
    const onlyProjectId = getArgument('project-id')

    admin.initializeApp({ projectId: firebaseProjectId })
    const db = admin.firestore()

    const projectIds = onlyProjectId
        ? [onlyProjectId]
        : (await db.collection(KNOWLEDGE_BASES_COLLECTION).get()).docs.map(doc => doc.id)
    console.log(
        `${dryRun ? 'DRY RUN' : 'EXECUTE'}: ${projectIds.length} wiki(s) on ${firebaseProjectId}${force ? ' (--force)' : ''}`
    )

    const stats = { requested: 0, pages: 0, skipped: {} }
    for (const projectId of projectIds) {
        const result = await requestCurrentStateRewrite({ db, projectId, now: Date.now(), dryRun, force })
        if (result.requested || result.reason === 'dry_run') {
            stats.requested += 1
            stats.pages += result.slugs.length
            console.log(
                `  ${dryRun ? 'would request' : 'requested'}: ${projectId} (${result.slugs.length} page(s): ${result.slugs.join(', ')})`
            )
        } else {
            stats.skipped[result.reason] = (stats.skipped[result.reason] || 0) + 1
            console.log(`  skipped: ${projectId} (${result.reason})`)
        }
    }

    console.log(
        `${dryRun ? 'Would request' : 'Requested'} the pass for ${stats.requested} wiki(s), ${stats.pages} page(s). Skipped: ${
            JSON.stringify(stats.skipped) === '{}' ? 'none' : JSON.stringify(stats.skipped)
        }`
    )
}

if (require.main === module) {
    main().catch(error => {
        console.error(error)
        process.exit(1)
    })
}
