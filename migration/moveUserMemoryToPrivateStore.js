#!/usr/bin/env node

// security audit 2026-11 (NV-20): moves what the assistant remembered about each user out of
// their per-project profile note and into the private, server-only `assistantMemories` store.
//
// Until NV-20 every `update_user_memory` call inserted one line `YYYY-MM-DD: <fact>` at the top of
// users/{uid}.noteIdsByProject[projectId], a note every project member can read and edit, and the
// WHOLE note body was injected into that user's assistant runs as "User memory". Deployed
// functions now read and write only `assistantMemories/{uid}__{projectId}` and never read the note.
// Without this script those users' assistants simply start with an empty memory; with it, the
// remembered lines move to the private store and are deleted from the note.
//
// What moves: plain-text lines matching `YYYY-MM-DD: <text>` (the only shape the assistant wrote).
// What stays: everything else in the note, including text the user or a teammate wrote by hand.
// That text is no longer injected into any assistant run.
//
// Risks, read before --execute:
//   - A line a PERSON wrote in that date format is treated as memory: it moves into the private
//     store (where only the owner and their assistant see it) and disappears from the note. The
//     dry run prints every line it would move, so review it.
//   - A line a TEAMMATE planted in that format moves too. The private store is then the only place
//     it lives; the owner can review and delete it in the profile Note tab's "Assistant memory" panel.
//   - The note body is rewritten in Storage. A browser that has the note open with unsaved edits and
//     then saves its full state could restore the deleted lines (the same race every server-side note
//     edit has). The script is idempotent: run it again later and it moves nothing twice (duplicates
//     are skipped) and deletes any line that came back.
//   - Notes the old code created only for memory ("<Name> memory" heading) are kept, not deleted;
//     they may end up holding just that heading.
//
// Usage:
//   node migration/moveUserMemoryToPrivateStore.js --firebase-project-id=<gcp-project-id>              (dry run)
//   node migration/moveUserMemoryToPrivateStore.js --firebase-project-id=<gcp-project-id> --execute    (apply)
//   ... --user-id=<uid>   only this user        ... --project-id=<alldone project id>   only this project
//
// Application Default Credentials are used (gcloud auth application-default login, or a service
// account via GOOGLE_APPLICATION_CREDENTIALS). Deploy the functions first, so no running assistant
// writes a new line into a note after the script has emptied it.

const admin = require('../functions/node_modules/firebase-admin')
const Y = require('../functions/node_modules/yjs')

const { getExpectedNotesBucket } = require('../functions/shared/notesStorageBucket')
const { ASSISTANT_MEMORY_COLLECTION, buildAssistantMemoryDocId } = require('../functions/Assistant/userMemoryHelper')
const {
    findMemoryEntriesInYText,
    mergeMemoryEntries,
    removeRangesFromYText,
} = require('../functions/Assistant/userMemoryMigration')

function getArgument(name) {
    const prefix = `--${name}=`
    const argument = process.argv.find(value => value.startsWith(prefix))
    return argument ? argument.slice(prefix.length) : null
}

async function migrateNote({ db, bucket, userId, projectId, noteId, dryRun, stats }) {
    const file = bucket.file(`notesData/${projectId}/${noteId}`)
    const [exists] = await file.exists()
    if (!exists) return

    const [buffer] = await file.download()
    const doc = new Y.Doc()
    Y.applyUpdate(doc, new Uint8Array(buffer))
    const ytext = doc.getText('quill')
    const { entries, ranges } = findMemoryEntriesInYText(ytext)
    if (entries.length === 0) return

    stats.notes++
    stats.lines += entries.length
    console.log(`users/${userId} project ${projectId} note ${noteId}: ${entries.length} memory line(s)`)
    entries.forEach(entry => console.log(`    ${entry}`))
    if (dryRun) return

    // 1. Private store first: if the note write fails afterwards, the memory is not lost.
    const memoryRef = db.collection(ASSISTANT_MEMORY_COLLECTION).doc(buildAssistantMemoryDocId(userId, projectId))
    await db.runTransaction(async transaction => {
        const memoryDoc = await transaction.get(memoryRef)
        const existing = memoryDoc.exists ? memoryDoc.data().content || '' : ''
        const merged = mergeMemoryEntries(existing, entries)
        stats.added += merged.added
        transaction.set(
            memoryRef,
            { userId, projectId, content: merged.content, updatedAt: Date.now(), updatedBy: 'migration' },
            { merge: true }
        )
    })

    // 2. Then remove the lines from the note body, and stamp the note so open clients re-download it.
    removeRangesFromYText(ytext, ranges)
    await file.save(Buffer.from(Y.encodeStateAsUpdate(doc)), {
        metadata: { contentType: 'application/octet-stream' },
    })
    const remaining = ytext.toString()
    await db
        .doc(`noteItems/${projectId}/notes/${noteId}`)
        .update({
            preview: remaining.length > 150 ? remaining.substring(0, 147) + '...' : remaining,
            lastEditionDate: Date.now(),
        })
        .catch(error => console.warn(`    note document not updated: ${error.message}`))
    stats.cleaned++
}

async function main() {
    const firebaseProjectId = getArgument('firebase-project-id')
    if (!firebaseProjectId) {
        console.error('Missing --firebase-project-id=<gcp-project-id>')
        process.exit(1)
    }
    const dryRun = !process.argv.includes('--execute')
    const onlyUserId = getArgument('user-id')
    const onlyProjectId = getArgument('project-id')

    const bucketName = getExpectedNotesBucket(firebaseProjectId) || getArgument('notes-bucket')
    if (!bucketName) {
        console.error(`No notes bucket known for ${firebaseProjectId}; pass --notes-bucket=<name>`)
        process.exit(1)
    }

    admin.initializeApp({ projectId: firebaseProjectId })
    const db = admin.firestore()
    const bucket = admin.storage().bucket(bucketName)

    const userDocs = onlyUserId
        ? [await db.collection('users').doc(onlyUserId).get()].filter(doc => doc.exists)
        : (await db.collection('users').select('noteIdsByProject').get()).docs

    console.log(
        `${dryRun ? 'DRY RUN' : 'EXECUTE'}: ${userDocs.length} user(s) on ${firebaseProjectId}, notes bucket ${bucketName}`
    )

    const stats = { notes: 0, lines: 0, added: 0, cleaned: 0, failed: 0 }
    for (const userDoc of userDocs) {
        const noteIdsByProject = (userDoc.data() || {}).noteIdsByProject || {}
        for (const [projectId, noteId] of Object.entries(noteIdsByProject)) {
            if (!noteId || (onlyProjectId && projectId !== onlyProjectId)) continue
            try {
                await migrateNote({ db, bucket, userId: userDoc.id, projectId, noteId, dryRun, stats })
            } catch (error) {
                stats.failed++
                console.error(`users/${userDoc.id} project ${projectId} note ${noteId}: failed`, error.message)
            }
        }
    }

    console.log(
        dryRun
            ? `Would move ${stats.lines} line(s) from ${stats.notes} note(s). ${stats.failed} failed to read.`
            : `Moved ${stats.lines} line(s) from ${stats.notes} note(s) (${stats.added} new in the private store), ` +
                  `cleaned ${stats.cleaned} note(s), ${stats.failed} failed.`
    )
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
