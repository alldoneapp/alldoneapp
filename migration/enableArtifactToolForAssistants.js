#!/usr/bin/env node

// Switches the new `artifacts` Tools Access permission on for existing assistants.
//
// New assistants get it by default (DEFAULT_ALLOWED_TOOLS in
// components/AssistantDetailedView/Customizations/ToolsAccess/toolOptions.js), but an assistant
// stores its own `allowedTools` list, so every assistant created before the artifact tools existed
// can neither create nor read an artifact until somebody ticks the box. This adds the key to every
// assistant that may already create notes (`create_note`), i.e. assistants whose owner let them
// produce content; `--all` adds it to every assistant that has an allowedTools list at all.
// Assistants whose owner chose no tools are never touched.
//
// Usage:
//   node migration/enableArtifactToolForAssistants.js --firebase-project-id=<gcp-project-id>               (dry run)
//   node migration/enableArtifactToolForAssistants.js --firebase-project-id=<gcp-project-id> --execute     (apply)
//   node migration/enableArtifactToolForAssistants.js --firebase-project-id=<gcp-project-id> --all --execute
//
// Application Default Credentials are used (gcloud auth application-default login, or a
// service account via GOOGLE_APPLICATION_CREDENTIALS).

const admin = require('../functions/node_modules/firebase-admin')

const ARTIFACT_TOOL_KEY = 'artifacts'
const CONTENT_TOOL_KEY = 'create_note'
const BATCH_SIZE = 400

function getArgument(name) {
    const prefix = `--${name}=`
    const argument = process.argv.find(value => value.startsWith(prefix))
    return argument ? argument.slice(prefix.length) : null
}

function shouldEnable(allowedTools, includeAll) {
    if (!Array.isArray(allowedTools) || allowedTools.length === 0) return false
    if (allowedTools.includes(ARTIFACT_TOOL_KEY)) return false
    return includeAll || allowedTools.includes(CONTENT_TOOL_KEY)
}

async function main() {
    const firebaseProjectId = getArgument('firebase-project-id')
    if (!firebaseProjectId) {
        console.error('Missing --firebase-project-id=<gcp-project-id>')
        process.exit(1)
    }
    const dryRun = !process.argv.includes('--execute')
    const includeAll = process.argv.includes('--all')

    admin.initializeApp({ projectId: firebaseProjectId })
    const db = admin.firestore()

    // `assistants/{projectId}` parents are usually not documents themselves, so list them.
    const parents = await db.collection('assistants').listDocuments()
    console.log(
        `${dryRun ? 'DRY RUN' : 'EXECUTE'}: scanning ${parents.length} assistant scope(s) on ${firebaseProjectId}`
    )

    const stats = { assistants: 0, enabled: 0 }
    let batch = db.batch()
    let pending = 0
    const flush = async () => {
        if (pending === 0) return
        if (!dryRun) await batch.commit()
        batch = db.batch()
        pending = 0
    }

    for (const parent of parents) {
        const snapshot = await parent.collection('items').get()
        for (const doc of snapshot.docs) {
            stats.assistants++
            const { allowedTools, displayName } = doc.data() || {}
            if (!shouldEnable(allowedTools, includeAll)) continue
            console.log(`  ${dryRun ? 'would enable' : 'enabling'}: ${doc.ref.path} (${displayName || 'unnamed'})`)
            batch.update(doc.ref, { allowedTools: admin.firestore.FieldValue.arrayUnion(ARTIFACT_TOOL_KEY) })
            pending++
            stats.enabled++
            if (pending >= BATCH_SIZE) await flush()
        }
    }
    await flush()

    console.log(
        `${dryRun ? 'Would enable' : 'Enabled'} artifacts for ${stats.enabled} of ${stats.assistants} assistant(s).`
    )
}

if (require.main === module) {
    main().catch(error => {
        console.error(error)
        process.exit(1)
    })
}

module.exports = { shouldEnable }
