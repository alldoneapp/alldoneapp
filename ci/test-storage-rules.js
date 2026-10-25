#!/usr/bin/env node
'use strict'

// Tests storage.rules (default bucket) and storage.notes.rules (notes bucket) with the Firebase
// Rules API test endpoint, which compiles and evaluates the real rules without publishing them.
// firestore.get() is answered by function mocks describing a small fixed world:
//   p1  private project (isShared 2), member u1
//   p2  public project  (isShared 0), member u2, notes "pub" (readerIds has 0) and "priv"
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
    [`${DOCS}/projects/p1`]: { userIds: ['u1'], isShared: 2 },
    [`${DOCS}/projects/p2`]: { userIds: ['u2'], isShared: 0 },
    [`${DOCS}/roles/administrator`]: { userId: 'admin1' },
    [`${DOCS}/noteItems/p2/notes/pub`]: { readerIds: [0, 'u2'] },
    [`${DOCS}/noteItems/p2/notes/priv`]: { readerIds: ['u2'] },
}
const functionMocks = Object.entries(MOCK_DATA).map(([docPath, data]) => ({
    function: 'firestore.get',
    args: [{ exactValue: docPath }],
    result: { value: { data } },
}))

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
    ['ALLOW', 'create', 'attachments/c1/file.png', 'u3'],
    ['ALLOW', 'list', 'attachments/c1', 'u3'],
    ['ALLOW', 'get', 'attachments/c1/file.png', 'u3'],
    ['DENY', 'list', 'attachments', 'u3'],
    ['ALLOW', 'create', 'feedAttachments/251025/abc/file.png', 'u3'],
    ['ALLOW', 'get', 'feedAttachments/251025/abc/file.png', 'u3'],
    ['DENY', 'list', 'feedAttachments/251025', 'u3'],
    ['ALLOW', 'create', 'notesAttachments/251025/abc/file.png', 'u3'],
    ['DENY', 'list', 'notesAttachments/251025', 'u3'],
    ['ALLOW', 'get', 'someServerFolder/x.png', 'u1'],
    ['DENY', 'create', 'someServerFolder/x.png', 'u1'],
    ['DENY', 'list', 'someServerFolder', 'u1'],
    ['DENY', 'get', 'attachments/c1/file.png', null],
    ['DENY', 'get', 'projectsContacts/p1/c1/c1@123', null],
]

const NOTES_CASES = [
    ['ALLOW', 'get', 'notesData/p1/n1', 'u1'],
    ['ALLOW', 'create', 'notesData/p1/n1', 'u1'],
    ['ALLOW', 'update', 'notesData/p1/n1', 'u1'],
    ['DENY', 'get', 'notesData/p1/n1', 'u3'],
    ['DENY', 'update', 'notesData/p1/n1', 'u3'],
    ['DENY', 'list', 'notesData/p1', 'u1'],
    ['ALLOW', 'get', 'notesData/p2/pub', 'u3'],
    ['DENY', 'get', 'notesData/p2/priv', 'u3'],
    ['ALLOW', 'get', 'notesData/p2/priv', 'u2'],
    ['DENY', 'create', 'notesData/p2/pub', 'u3'],
    ['DENY', 'get', 'notesData/p1/n1', null],
    ['DENY', 'get', 'communityNotesData/p1/n1', 'u1'],
    ['DENY', 'get', 'noteDailyVersionsData/p1/n1', 'u1'],
]

function testCase(bucket, [expectation, method, objectPath, uid]) {
    const request = { method, path: `/b/${bucket}/o/${objectPath}`, auth: uid ? { uid, token: { sub: uid } } : null }
    if (method === 'create' || method === 'update') {
        request.resource = { size: 10, contentType: 'application/octet-stream' }
    }
    return { expectation, request, functionMocks }
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
