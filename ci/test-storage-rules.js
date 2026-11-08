#!/usr/bin/env node
'use strict'

// Tests storage.rules (default bucket) and storage.notes.rules (notes bucket) with the Firebase
// Rules API test endpoint, which compiles and evaluates the real rules without publishing them.
// firestore.get() / firestore.exists() are answered by function mocks describing a small world:
//   p1  private project (isShared 2), members u1 and u4. Notes:
//         n1       project-public (readerIds [0, u1, u4])
//         mine4    u4's private note (readerIds [u4])
//         pending  just created, no projection yet, isPublicFor [0]
//         pending4 just created by u4, no projection yet, isPublicFor [u4]
//         moved    no note document yet (setNoteProject writes the body first)
//         gone4    deleted: no note document, but its version copies are still in the bucket
//   p2  public project (isShared 0), member u2, notes "pub" (readerIds has 0) and "priv"
//         gonepub  deleted note in the public project
//   admin1 is roles/administrator; u3 is a member of nothing
//
//   node ci/test-storage-rules.js [gcp-project-id]      (default alldonestaging)
//
// Needs `gcloud auth login`. Nothing is written to the project. Exit code 1 on any failure.

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const projectId = process.argv[2] || 'alldonestaging'
const repo = path.resolve(__dirname, '..')
const DOCS = '/databases/(default)/documents'
const MOCK_DATA = {
    [`${DOCS}/projects/p1`]: { userIds: ['u1', 'u4'], isShared: 2 },
    [`${DOCS}/projects/p2`]: { userIds: ['u2'], isShared: 0 },
    [`${DOCS}/roles/administrator`]: { userId: 'admin1' },
    [`${DOCS}/noteItems/p1/notes/n1`]: { readerIds: [0, 'u1', 'u4'], isPublicFor: [0] },
    [`${DOCS}/noteItems/p1/notes/mine4`]: { readerIds: ['u4'], isPublicFor: ['u4'] },
    [`${DOCS}/noteItems/p1/notes/pending`]: { isPublicFor: [0] },
    [`${DOCS}/noteItems/p1/notes/pending4`]: { isPublicFor: ['u4'] },
    [`${DOCS}/noteItems/p2/notes/pub`]: { readerIds: [0, 'u2'], isPublicFor: [0] },
    [`${DOCS}/noteItems/p2/notes/priv`]: { readerIds: ['u2'], isPublicFor: ['u2'] },
}
const MISSING_NOTES = [
    `${DOCS}/noteItems/p1/notes/moved`,
    `${DOCS}/noteItems/p1/notes/gone4`,
    `${DOCS}/noteItems/p2/notes/gonepub`,
]
const functionMocks = [
    ...Object.entries(MOCK_DATA).map(([docPath, data]) => ({
        function: 'firestore.get',
        args: [{ exactValue: docPath }],
        result: { value: { data } },
    })),
    ...Object.keys(MOCK_DATA)
        .filter(docPath => docPath.includes('/noteItems/'))
        .map(docPath => ({ function: 'firestore.exists', args: [{ exactValue: docPath }], result: { value: true } })),
    ...MISSING_NOTES.map(docPath => ({
        function: 'firestore.exists',
        args: [{ exactValue: docPath }],
        result: { value: false },
    })),
]

const DEFAULT_CASES = [
    ['DENY', 'get', 'artifacts/p1/a1/v1/index.html', 'u1'],
    ['DENY', 'create', 'artifacts/p1/a1/v1/index.html', 'u1'],
    ['ALLOW', 'get', 'noteVersionsData/p1/n1/v1', 'u1'],
    ['ALLOW', 'create', 'noteVersionsData/p1/n1/v1', 'u1'],
    ['ALLOW', 'delete', 'noteVersionsData/p1/n1/v1', 'u1'],
    ['DENY', 'get', 'noteVersionsData/p1/n1/v1', 'u3'],
    ['DENY', 'create', 'noteVersionsData/p1/n1/v1', 'u3'],
    ['ALLOW', 'get', 'noteVersionsData/p2/pub/v1', 'u3'],
    ['DENY', 'get', 'noteVersionsData/p2/priv/v1', 'u3'],
    ['DENY', 'create', 'noteVersionsData/p2/pub/v1', 'u3'],
    ['DENY', 'list', 'noteVersionsData/p1/n1', 'u1'],
    ['DENY', 'get', 'noteVersionsData/p1/mine4/v1', 'u1'],
    ['ALLOW', 'get', 'noteVersionsData/p1/mine4/v1', 'u4'],
    ['DENY', 'get', 'noteDailyVersionsData/p1/mine4', 'u1'],
    ['DENY', 'create', 'noteDailyVersionsData/p1/mine4', 'u1'],
    ['ALLOW', 'create', 'noteDailyVersionsData/p1/mine4', 'u4'],
    ['ALLOW', 'create', 'noteDailyVersionsData/p1/n1', 'u1'],
    ['ALLOW', 'delete', 'noteDailyVersionsData/p1/n1', 'u1'],
    ['DENY', 'get', 'noteDailyVersionsData/p1/n1', 'u3'],
    ['ALLOW', 'create', 'projectsContacts/p1/c1/c1@123', 'u1'],
    ['ALLOW', 'create', 'projectsContacts/p1/c1/c1@123_50x50', 'u1'],
    ['ALLOW', 'list', 'projectsContacts/p1/c1', 'u1'],
    ['ALLOW', 'delete', 'projectsContacts/p1/c1/c1@123', 'u1'],
    ['DENY', 'get', 'projectsContacts/p1/c1/c1@123', 'u3'],
    ['DENY', 'list', 'projectsContacts/p1/c1', 'u3'],
    ['ALLOW', 'create', 'assistants/p1/a1/a1@123', 'u1'],
    ['ALLOW', 'list', 'assistants/p1/items/a1', 'u1'],
    ['DENY', 'create', 'assistants/p1/a1/a1@123', 'u3'],
    ['ALLOW', 'create', 'assistants/globalProject/g1/g1@1', 'admin1'],
    ['DENY', 'create', 'assistants/globalProject/g1/g1@1', 'u1'],
    ['ALLOW', 'create', 'feeds/p1/c1_x@1_50x50', 'u1'],
    ['DENY', 'create', 'feeds/p1/c1_x@1_50x50', 'u3'],
    ['ALLOW', 'create', 'invoiceLogos/p1/u1/logo', 'u1'],
    ['ALLOW', 'delete', 'invoiceLogos/p1/u1/logo', 'u1'],
    ['DENY', 'create', 'invoiceLogos/p1/u3/logo', 'u3'],
    ['DENY', 'get', 'invoiceLogos/p1/u1/logo', 'u3'],
    // NV-39: version copies of a deleted note are no longer reachable through membership
    ['DENY', 'get', 'noteDailyVersionsData/p1/gone4', 'u1'],
    ['DENY', 'get', 'noteDailyVersionsData/p1/gone4', 'u4'],
    ['DENY', 'create', 'noteDailyVersionsData/p1/gone4', 'u1'],
    ['DENY', 'update', 'noteDailyVersionsData/p1/gone4', 'u1'],
    ['DENY', 'delete', 'noteDailyVersionsData/p1/gone4', 'u1'],
    ['DENY', 'get', 'noteVersionsData/p1/gone4/v1', 'u1'],
    ['DENY', 'create', 'noteVersionsData/p1/gone4/v1', 'u1'],
    ['DENY', 'delete', 'noteVersionsData/p1/gone4/v1', 'u1'],
    ['DENY', 'get', 'noteVersionsData/p1/moved/v1', 'u1'],
    ['DENY', 'get', 'noteVersionsData/p2/gonepub/v1', 'u3'],
    ['DENY', 'get', 'noteVersionsData/p2/gonepub/v1', 'u2'],
    // ...while a note that exists keeps every flow: save a version, restore, daily copy
    ['ALLOW', 'update', 'noteDailyVersionsData/p1/n1', 'u1'],
    ['ALLOW', 'get', 'noteDailyVersionsData/p1/mine4', 'u4'],
    ['ALLOW', 'delete', 'noteDailyVersionsData/p1/mine4', 'u4'],
    ['ALLOW', 'delete', 'noteVersionsData/p1/mine4/v1', 'u4'],
    ['DENY', 'delete', 'noteVersionsData/p1/mine4/v1', 'u1'],
    // NV-38: comment attachments are server-only (the VM runner writes them through the Admin SDK)
    ['DENY', 'create', 'attachments/c1/file.png', 'u3'],
    ['DENY', 'create', 'attachments/c1/file.png', 'u1', { requestUploader: 'u1' }],
    ['DENY', 'update', 'attachments/c1/file.png', 'u3', { uploader: 'u3', requestUploader: 'u3' }],
    ['DENY', 'delete', 'attachments/c1/file.png', 'u3', { uploader: 'u1' }],
    ['DENY', 'list', 'attachments/c1', 'u3'],
    ['DENY', 'get', 'attachments/c1/file.png', 'u3', { uploader: 'u1' }],
    ['DENY', 'list', 'attachments', 'u3'],
    ['DENY', 'get', 'attachments/c1/file.png', null],
    // NV-38: feed and note uploads are bound to their uploader (customMetadata.uploaderId)
    ...['feedAttachments', 'notesAttachments'].flatMap(folder => {
        const file = `${folder}/251025/abc/file.png`
        return [
            ['ALLOW', 'create', file, 'u3', { requestUploader: 'u3' }],
            ['DENY', 'create', file, 'u3'],
            ['DENY', 'create', file, 'u3', { requestUploader: 'u1' }],
            ['ALLOW', 'get', file, 'u3', { uploader: 'u3' }],
            ['DENY', 'get', file, 'u1', { uploader: 'u3' }],
            ['DENY', 'get', file, 'u1', { uploader: null }],
            ['ALLOW', 'update', file, 'u3', { uploader: 'u3', requestUploader: 'u3' }],
            ['DENY', 'update', file, 'u3', { uploader: 'u3', requestUploader: 'u1' }],
            ['DENY', 'update', file, 'u1', { uploader: 'u3', requestUploader: 'u1' }],
            ['DENY', 'update', file, 'u1', { uploader: null, requestUploader: 'u1' }],
            ['ALLOW', 'delete', file, 'u3', { uploader: 'u3' }],
            ['DENY', 'delete', file, 'u1', { uploader: 'u3' }],
            ['DENY', 'delete', file, 'u1', { uploader: null }],
            ['DENY', 'list', `${folder}/251025`, 'u3'],
            ['DENY', 'get', file, null, { uploader: 'u3' }],
        ]
    }),
    // NV-37: server-written folders are no longer readable by path; invoices above all
    ['DENY', 'get', 'Invoice/u1/2026 - 0001.pdf', 'u3'],
    ['DENY', 'get', 'Invoice/u1/2026 - 0001.pdf', 'u1'],
    ['DENY', 'create', 'Invoice/u3/2026 - 0001.pdf', 'u3'],
    ['DENY', 'list', 'Invoice/u1', 'u1'],
    ['DENY', 'get', 'anna-email-inbound/m1/raw.eml', 'u1'],
    ['DENY', 'get', 'browserEvidence/r1/s1.png', 'u1'],
    ['DENY', 'get', 'whatsapp-images/x.jpg', 'u1'],
    ['DENY', 'get', 'someServerFolder/x.png', 'u1'],
    ['DENY', 'create', 'someServerFolder/x.png', 'u1'],
    ['DENY', 'list', 'someServerFolder', 'u1'],
    ['DENY', 'get', 'projectsContacts/p1/c1/c1@123', null],
]

const NOTES_CASES = [
    ['ALLOW', 'get', 'notesData/p1/n1', 'u1'],
    ['ALLOW', 'create', 'notesData/p1/n1', 'u1'],
    ['ALLOW', 'update', 'notesData/p1/n1', 'u1'],
    ['DENY', 'get', 'notesData/p1/n1', 'u3'],
    ['DENY', 'update', 'notesData/p1/n1', 'u3'],
    ['DENY', 'list', 'notesData/p1', 'u1'],
    // another member's private note: closed (it was readable by membership alone)
    ['DENY', 'get', 'notesData/p1/mine4', 'u1'],
    ['DENY', 'update', 'notesData/p1/mine4', 'u1'],
    ['ALLOW', 'get', 'notesData/p1/mine4', 'u4'],
    ['ALLOW', 'update', 'notesData/p1/mine4', 'u4'],
    // a note created a moment ago, before its readerIds projection: isPublicFor decides
    ['ALLOW', 'create', 'notesData/p1/pending', 'u1'],
    ['ALLOW', 'get', 'notesData/p1/pending', 'u1'],
    ['ALLOW', 'create', 'notesData/p1/pending4', 'u4'],
    ['DENY', 'get', 'notesData/p1/pending4', 'u1'],
    // moving a note: the body lands before the note document exists in the new project
    ['ALLOW', 'create', 'notesData/p1/moved', 'u1'],
    ['DENY', 'create', 'notesData/p1/moved', 'u3'],
    ['ALLOW', 'get', 'notesData/p2/pub', 'u3'],
    ['DENY', 'get', 'notesData/p2/priv', 'u3'],
    ['ALLOW', 'get', 'notesData/p2/priv', 'u2'],
    ['DENY', 'create', 'notesData/p2/pub', 'u3'],
    ['DENY', 'get', 'notesData/p1/n1', null],
    ['DENY', 'get', 'communityNotesData/p1/n1', 'u1'],
    ['DENY', 'get', 'noteDailyVersionsData/p1/n1', 'u1'],
]

// Optional fifth element: { uploader, requestUploader }. `uploader` describes the EXISTING object
// (`resource`, present for get/update/delete; null means an object without custom metadata, as
// every upload from before NV-38 is), `requestUploader` the custom metadata of the put.
function storageObject(bucket, objectPath, uploader) {
    return {
        name: objectPath,
        bucket,
        size: 10,
        contentType: 'application/octet-stream',
        metadata: uploader ? { uploaderId: uploader } : {},
    }
}

function testCase(bucket, [expectation, method, objectPath, uid, objects = {}]) {
    const request = { method, path: `/b/${bucket}/o/${objectPath}`, auth: uid ? { uid, token: { sub: uid } } : null }
    if (method === 'create' || method === 'update') {
        request.resource = storageObject(bucket, objectPath, objects.requestUploader)
    }
    const entry = { expectation, request, functionMocks }
    if ('uploader' in objects) entry.resource = storageObject(bucket, objectPath, objects.uploader)
    return entry
}

async function runSuite(token, rulesFile, bucket, cases) {
    const response = await fetch(`https://firebaserules.googleapis.com/v1/projects/${projectId}:test`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'x-goog-user-project': projectId,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            source: { files: [{ name: rulesFile, content: fs.readFileSync(path.join(repo, rulesFile), 'utf8') }] },
            testSuite: { testCases: cases.map(entry => testCase(bucket, entry)) },
        }),
    })
    const result = await response.json()
    if (!result.testResults) {
        console.error(`${rulesFile}: the Rules API returned no results`, JSON.stringify(result).slice(0, 1000))
        return 1
    }
    let failures = 0
    result.testResults.forEach((outcome, index) => {
        const [expectation, method, objectPath, uid] = cases[index]
        if (outcome.state === 'SUCCESS') return
        failures++
        console.error(
            `FAIL ${rulesFile}: ${expectation} ${method} ${objectPath} as ${uid || 'anonymous'}`,
            outcome.debugMessages || ''
        )
    })
    // A compile warning is treated as a failure: a type error in a rule evaluates to an error,
    // and an error is a denial, so it can lock everyone out while "deny" cases still pass.
    for (const issue of result.issues || []) {
        failures++
        console.error(
            `ISSUE ${rulesFile}:${issue.sourcePosition && issue.sourcePosition.line}`,
            issue.severity,
            issue.description
        )
    }
    console.log(
        `${rulesFile}: ${cases.length - failures}/${cases.length} cases, ${(result.issues || []).length} issues`
    )
    return failures
}

async function main() {
    const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim()
    const failures =
        (await runSuite(token, 'storage.rules', `${projectId}.appspot.com`, DEFAULT_CASES)) +
        (await runSuite(token, 'storage.notes.rules', 'notescontent', NOTES_CASES))
    process.exit(failures ? 1 : 0)
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
