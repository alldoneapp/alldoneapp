#!/usr/bin/env node

// Moves golden VM setup commands from the member-writable project document into the server-only
// vmGoldens/{projectId} document (security audit 2026-11, see functions/Assistant/vmGolden.js).
//
// Since that change the golden build reads `setupCommand` only from vmGoldens/{projectId}, so a
// command still sitting at projects/{projectId}.vmGolden.setupCommand is ignored. Any project member
// could write that field until the rules change, so REVIEW every printed command before moving it:
// pass the reviewed project ids with --only. Moving one also deletes the project-doc copy.
//
// Usage:
//   node migration/moveVmGoldenSetupCommands.js --firebase-project-id=<gcp-project-id>
//       (dry run: lists every project-doc setup command)
//   node migration/moveVmGoldenSetupCommands.js --firebase-project-id=<gcp-project-id> --only=<pid1,pid2> --execute
//
// Application Default Credentials are used (gcloud auth application-default login, or a
// service account via GOOGLE_APPLICATION_CREDENTIALS).

const admin = require('../functions/node_modules/firebase-admin')

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
    const only = new Set(
        (getArgument('only') || '')
            .split(',')
            .map(id => id.trim())
            .filter(Boolean)
    )
    if (!dryRun && only.size === 0) {
        console.error('--execute needs --only=<reviewed project ids>; run the dry run first and review each command.')
        process.exit(1)
    }

    admin.initializeApp({ projectId: firebaseProjectId })
    const db = admin.firestore()
    const { FieldValue } = require(
        require.resolve('firebase-admin/firestore', { paths: [require('path').join(__dirname, '..', 'functions')] })
    )

    const snapshot = await db.collection('projects').select('vmGolden').get()
    console.log(`${dryRun ? 'DRY RUN' : 'EXECUTE'}: scanning ${snapshot.size} project(s) on ${firebaseProjectId}`)

    let found = 0
    let moved = 0
    for (const doc of snapshot.docs) {
        const golden = (doc.data() || {}).vmGolden || {}
        const command = typeof golden.setupCommand === 'string' ? golden.setupCommand.trim() : ''
        if (!command) continue
        found++
        console.log(`- ${doc.id}: ${JSON.stringify(command)}`)
        if (dryRun || !only.has(doc.id)) continue
        await db.doc(`vmGoldens/${doc.id}`).set(
            {
                projectId: doc.id,
                setupCommand: command,
                setupCommandSetBy: 'migration/moveVmGoldenSetupCommands',
                setupCommandSetAt: Date.now(),
            },
            { merge: true }
        )
        await doc.ref.update({ 'vmGolden.setupCommand': FieldValue.delete() })
        moved++
    }
    console.log(`Found ${found} project-doc setup command(s); moved ${moved}.`)
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
