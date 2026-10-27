'use strict'

// The artifact feature end to end, in the REAL app against the local Firebase emulators
// (`npm run emulators` + `npm run dev:web`): sign in, upload an HTML dashboard, see it rendered,
// switch on live project data and watch the dashboard read the project through the bridge, talk
// about it in its chat, read its history, link it from a task and see the backlink, and open it as
// a preview card inside a note.
//
//   node browser-tests/artifacts/e2e.js       (emulators and dev server must be running)
//
// Screenshots land in ARTIFACT_E2E_SHOTS (default: a temp directory) for a human to look at.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { chromium } = require('playwright')

const APP = process.env.APP_URL || 'https://localhost:19006'
const PROJECT = 'alldonestaging'
const FIRESTORE = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const SHOTS = process.env.ARTIFACT_E2E_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-e2e-'))
const ADMIN = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }
const EMAIL = 'artifact.e2e@example.com'

const DASHBOARD = `<!doctype html><html><head><title>Live dashboard</title></head><body>
<h1 id="heading">Team dashboard</h1><p id="status">waiting</p>
<script src="_alldone/bridge.js"></script>
<script>
(async function () {
    var status = document.getElementById('status')
    if (!window.alldone || !alldone.available) { status.textContent = 'outside alldone'; return }
    try {
        var project = await alldone.project()
        var open = await alldone.tasks({ status: 'open' })
        status.textContent = 'live:' + project.name + ':' + open.length
        document.body.setAttribute('data-live', JSON.stringify({ project: project, open: open.map(function (t) { return t.title }) }))
    } catch (e) { status.textContent = 'error:' + e.message }
})()
</script></body></html>`

const results = []
function check(name, condition, detail) {
    results.push({ name, pass: !!condition, detail })
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : `  ${JSON.stringify(detail)}`}`)
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function poll(fn, { timeout = 30000, interval = 500 } = {}) {
    const end = Date.now() + timeout
    let last
    while (Date.now() < end) {
        try {
            last = await fn()
            if (last) return last
        } catch (error) {
            last = error
        }
        await wait(interval)
    }
    return null
}

// Firestore REST with the emulator's admin bypass.
const fromValue = value => {
    if (!value) return undefined
    if ('stringValue' in value) return value.stringValue
    if ('integerValue' in value) return Number(value.integerValue)
    if ('doubleValue' in value) return value.doubleValue
    if ('booleanValue' in value) return value.booleanValue
    if ('nullValue' in value) return null
    if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromValue)
    if ('mapValue' in value)
        return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k, v]) => [k, fromValue(v)]))
    return undefined
}
const toValue = value => {
    if (value === null) return { nullValue: null }
    if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } }
    if (typeof value === 'boolean') return { booleanValue: value }
    if (typeof value === 'number')
        return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
    if (typeof value === 'object')
        return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toValue(v)])) } }
    return { stringValue: String(value) }
}
async function listDocs(collectionPath) {
    const response = await fetch(`${FIRESTORE}/${collectionPath}?pageSize=200`, { headers: ADMIN })
    const body = await response.json()
    return (body.documents || []).map(doc => ({
        id: doc.name.split('/').pop(),
        ...Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, fromValue(v)])),
    }))
}
async function getDoc(docPath) {
    const response = await fetch(`${FIRESTORE}/${docPath}`, { headers: ADMIN })
    if (!response.ok) return null
    const doc = await response.json()
    return Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, fromValue(v)]))
}
async function setDoc(docPath, data) {
    const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toValue(v)]))
    const response = await fetch(`${FIRESTORE}/${docPath}`, {
        method: 'PATCH',
        headers: ADMIN,
        body: JSON.stringify({ fields }),
    })
    if (!response.ok) throw new Error(`setDoc ${docPath}: ${response.status} ${await response.text()}`)
}

// Every run starts from empty LOCAL emulators (never anything else: both addresses are loopback).
async function resetEmulators() {
    await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {
        method: 'DELETE',
    })
    await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })
}

async function shot(page, name) {
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false }).catch(() => {})
}

// Signs in without the Google widget: the Auth emulator accepts an unsigned Google identity, and the
// session is stored exactly where the Firebase SDK keeps it, so the app starts signed in. (The
// widget's redirect flow needs apis.google.com, which sandboxed environments often cannot reach.)
async function signIn(page) {
    const idToken = JSON.stringify({ sub: 'e2e-ada', email: EMAIL, email_verified: true, name: 'Ada Artifact' })
    const response = await fetch(
        'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=local-emulator-only',
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requestUri: 'http://localhost',
                postBody: `id_token=${encodeURIComponent(idToken)}&providerId=google.com`,
                returnSecureToken: true,
            }),
        }
    )
    const session = await response.json()
    if (!session.idToken) throw new Error(`Auth emulator sign-in failed: ${JSON.stringify(session)}`)

    await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(
        async ({ session, email }) => {
            const key = 'firebase:authUser:local-emulator-only:[DEFAULT]'
            const user = {
                uid: session.localId,
                email,
                emailVerified: true,
                displayName: 'Ada Artifact',
                isAnonymous: false,
                providerData: [
                    {
                        providerId: 'google.com',
                        uid: 'e2e-ada',
                        displayName: 'Ada Artifact',
                        email,
                        phoneNumber: null,
                        photoURL: null,
                    },
                ],
                stsTokenManager: {
                    refreshToken: session.refreshToken,
                    accessToken: session.idToken,
                    expirationTime: Date.now() + Number(session.expiresIn) * 1000,
                },
                createdAt: String(Date.now()),
                lastLoginAt: String(Date.now()),
                apiKey: 'local-emulator-only',
                appName: '[DEFAULT]',
            }
            await new Promise((resolve, reject) => {
                const open = indexedDB.open('firebaseLocalStorageDb', 1)
                open.onupgradeneeded = () =>
                    open.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' })
                open.onerror = () => reject(open.error)
                open.onsuccess = () => {
                    const tx = open.result.transaction('firebaseLocalStorage', 'readwrite')
                    tx.objectStore('firebaseLocalStorage').put({ fbase_key: key, value: user })
                    tx.oncomplete = resolve
                    tx.onerror = () => reject(tx.error)
                }
            })
        },
        { session, email: EMAIL }
    )
    await page.goto(APP, { waitUntil: 'domcontentloaded' })
    return session.localId
}

async function main() {
    // The Auth emulator's sign-in widget loads its UI from unpkg; behind a proxy Chromium has to use it.
    const proxyServer = process.env.HTTPS_PROXY || process.env.https_proxy
    const browser = await chromium.launch(
        proxyServer ? { proxy: { server: proxyServer, bypass: 'localhost,127.0.0.1,127.0.0.2' } } : {}
    )
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 1000 } })
    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(String(error?.message || error)))
    if (process.env.VERBOSE) page.on('console', message => console.log('[app]', message.text()))

    try {
        await resetEmulators()
        await signIn(page)

        // The new account gets its first project from the onboarding flow; find it.
        const user = await poll(
            async () => {
                const users = await listDocs('users')
                return users.find(candidate => candidate.email === EMAIL && candidate.projectIds?.length)
            },
            { timeout: 120000 }
        )
        check('signing in creates the account and its first project', !!user, user)
        if (!user) throw new Error('no user')
        const projectId = user.projectIds[0]
        const uid = user.id
        await shot(page, '01-signed-in')

        // 1. Upload an HTML dashboard into the project's Artefakte.
        await page.goto(`${APP}/projects/${projectId}/artifacts`, { waitUntil: 'domcontentloaded' })
        const input = page.locator('[data-testid="artifact-file-input"]').first()
        await input.waitFor({ state: 'attached', timeout: 60000 })
        await input.setInputFiles({
            name: 'team_dashboard.html',
            mimeType: 'text/html',
            buffer: Buffer.from(DASHBOARD),
        })

        const artifact = await poll(async () => (await listDocs(`artifactItems/${projectId}/artifacts`))[0], {
            timeout: 60000,
        })
        check('the upload creates an artifact through commitArtifactVersion', !!artifact, artifact)
        if (!artifact) throw new Error('no artifact')
        check(
            'the artifact is a web artifact owned by the uploader',
            artifact.kind === 'web' && artifact.userId === uid,
            {
                kind: artifact.kind,
                userId: artifact.userId,
            }
        )
        check(
            'the server projects readers onto it',
            Array.isArray(artifact.readerIds) && artifact.readerIds.includes(uid)
        )

        await page.getByTestId(`artifact-detail-${artifact.id}`).waitFor({ timeout: 30000 })
        check(
            'the new artifact opens at its own address',
            page.url().endsWith(`/projects/${projectId}/artifacts/${artifact.id}`),
            page.url()
        )

        // 2. It is rendered live, sandboxed, from the serve function.
        const previewFrame = await poll(
            async () => {
                const frame = page
                    .frames()
                    .find(candidate => candidate.url().includes(`/a/${projectId}/${artifact.id}/`))
                if (!frame) return null
                const heading = await frame
                    .locator('#heading')
                    .textContent({ timeout: 2000 })
                    .catch(() => null)
                return heading ? { frame, heading } : null
            },
            { timeout: 60000 }
        )
        check(
            'the preview renders the uploaded page',
            previewFrame?.heading === 'Team dashboard',
            previewFrame?.heading
        )
        const status = previewFrame ? await previewFrame.frame.locator('#status').textContent() : null
        check(
            'without live data the page gets no answer from Alldone',
            status !== null && !status.startsWith('live:'),
            status
        )
        await shot(page, '02-preview')

        // 3. A shared open task to show up on the dashboard.
        await setDoc(`items/${projectId}/tasks/e2e-shared-task`, {
            name: 'Prepare the launch',
            extendedName: 'Prepare the launch',
            userId: uid,
            creatorId: uid,
            currentReviewerId: uid,
            isPublicFor: [0, uid],
            isPrivate: false,
            done: false,
            inDone: false,
            parentId: null,
            isSubtask: false,
            dueDate: Date.now(),
            created: Date.now(),
            lastEditionDate: Date.now(),
            linkedParentArtifactsIds: [artifact.id],
            observersIds: [],
            subtaskIds: [],
            estimations: { '-1': 0 },
            stepHistory: [-1],
        })
        const projected = await poll(
            async () => {
                const task = await getDoc(`items/${projectId}/tasks/e2e-shared-task`)
                return task?.readerIds?.includes(uid) && task?.backlinkIdsVisibleTo?.[uid] ? task : null
            },
            { timeout: 60000 }
        )
        check(
            'the task trigger projects readers and the artifact backlink token',
            !!projected,
            projected?.backlinkIdsVisibleTo
        )

        // 4. Switch on live project data (owner, confirmed).
        await page.getByTestId('artifact-toggle-live-data').click()
        await page.getByTestId('artifact-live-data-warning').waitFor({ timeout: 10000 })
        await page.getByTestId('artifact-toggle-live-data').click()
        const switched = await poll(
            async () => (await getDoc(`artifactItems/${projectId}/artifacts/${artifact.id}`))?.dataAccess === true,
            {
                timeout: 30000,
            }
        )
        check('the owner switches on live data through the server', !!switched)

        const live = await poll(
            async () => {
                const frame = page.frames().find(candidate => candidate.url().includes('alldone-bridge=1'))
                if (!frame) return null
                const text = await frame
                    .locator('#status')
                    .textContent({ timeout: 2000 })
                    .catch(() => '')
                return text.startsWith('live:')
                    ? { text, data: await frame.locator('body').getAttribute('data-live') }
                    : null
            },
            { timeout: 60000 }
        )
        check('the dashboard reads the project live through the bridge', !!live, live)
        check(
            'it sees the shared open task with the viewer’s own access',
            !!live && JSON.parse(live.data).open.includes('Prepare the launch'),
            live?.data
        )
        await shot(page, '03-live-data')

        // 5. Linked from.
        const backlink = await poll(() => page.getByTestId('artifact-backlink-task-e2e-shared-task').isVisible(), {
            timeout: 30000,
        })
        check('the artifact lists the task that links to it', !!backlink)

        // 6. Its chat: post a comment.
        await page.getByTestId('artifact-section-chat').click()
        await page.getByTestId('artifact-chat').waitFor({ timeout: 30000 })
        const editor = page.locator('[data-testid="artifact-chat"] .ql-editor').last()
        await editor.waitFor({ timeout: 30000 })
        await editor.click()
        await page.keyboard.type('Looks good, ship it')
        await page.keyboard.press('Enter')
        const comment = await poll(
            async () => {
                const comments = await listDocs(`chatComments/${projectId}/artifacts/${artifact.id}/comments`)
                return comments.find(candidate => String(candidate.commentText || '').includes('Looks good'))
            },
            { timeout: 30000 }
        )
        check('a chat comment is stored under the artifact', !!comment, comment)
        const chatObject = await poll(() => getDoc(`chatObjects/${projectId}/chats/${artifact.id}`), { timeout: 30000 })
        check('the chat object is of type artifacts', chatObject?.type === 'artifacts', chatObject?.type)
        const counted = await poll(
            async () => {
                const doc = await getDoc(`artifactItems/${projectId}/artifacts/${artifact.id}`)
                return Number(doc?.commentsData?.amount) > 0 ? doc.commentsData : null
            },
            { timeout: 30000 }
        )
        check('the artifact keeps the chat preview and count', !!counted, counted)
        check('the address follows the section', page.url().endsWith('/chat'), page.url())
        await shot(page, '04-chat')

        // 7. Its history.
        await page.getByTestId('artifact-section-updates').click()
        const history = await poll(
            async () => {
                const text = await page.getByTestId('artifact-history').innerText({ timeout: 2000 })
                return text.includes('created the artifact') && text.includes('switched on live project data')
                    ? text
                    : null
            },
            { timeout: 30000 }
        )
        check('the history shows the creation and the live data switch', !!history, history)
        check('the address follows the section', page.url().endsWith('/updates'), page.url())
        await shot(page, '05-history')

        // 8. A reload lands on the same artifact and section.
        await page.reload({ waitUntil: 'domcontentloaded' })
        const reloaded = await poll(() => page.getByTestId('artifact-history').isVisible(), { timeout: 60000 })
        check('a reload restores the artifact and its section from the address', !!reloaded)

        // 9. Rename from the detail and see it in the history.
        await page.getByTestId('artifact-section-artifact').click()
        const titleInput = page.getByTestId('artifact-title-input')
        await titleInput.fill('Team dashboard 2026')
        await titleInput.press('Enter')
        const renamed = await poll(
            async () => {
                const events = await listDocs(`artifactItems/${projectId}/artifacts/${artifact.id}/history`)
                return events.find(event => event.type === 'renamed' && event.to === 'Team dashboard 2026')
            },
            { timeout: 30000 }
        )
        check('a rename is recorded by the update trigger', !!renamed, renamed)

        // 10. The list.
        await page.getByTestId('artifact-back').click()
        const row = await poll(() => page.getByTestId(`artifact-row-${artifact.id}`).isVisible(), { timeout: 30000 })
        check('the list shows the artifact', !!row)
        await shot(page, '06-list')

        // 11. The chat bubble opens the comment popup used everywhere else (AT-2888), and a message
        // written there lands in the artifact's own chat.
        await page.getByTestId(`artifact-row-${artifact.id}`).click()
        await page.getByTestId(`artifact-detail-${artifact.id}`).waitFor({ timeout: 30000 })
        await page.getByTestId('artifact-comments').click()
        const popupEditor = page.getByTestId('modal-chat-image-drop-zone').locator('.ql-editor').first()
        const popupOpen = await poll(() => popupEditor.isVisible(), { timeout: 15000 })
        check('the chat bubble opens the standard comment popup', !!popupOpen)
        await popupEditor.click()
        await page.keyboard.type('Add a chart of done tasks per week')
        await page.keyboard.press('Enter')
        const request = await poll(
            async () => {
                const comments = await listDocs(`chatComments/${projectId}/artifacts/${artifact.id}/comments`)
                return comments.find(candidate => String(candidate.commentText || '').includes('chart of done tasks'))
            },
            { timeout: 30000 }
        )
        check('the comment popup posts into the artifact chat', !!request, request)
        await shot(page, '07-assistant-request')

        // 12. In a note: a link to the artifact becomes a live preview card.
        const noteId = 'e2e-note'
        const now = Date.now()
        await setDoc(`noteItems/${projectId}/notes/${noteId}`, {
            title: 'artifact notes',
            extendedTitle: 'Artifact notes',
            preview: '',
            created: now,
            lastEditionDate: now,
            lastEditorId: uid,
            views: 0,
            creatorId: uid,
            userId: uid,
            hasStar: '#FFFFFF',
            isPrivate: false,
            isPublicFor: [0, uid],
            stickyData: { stickyEndDate: 0, days: 0 },
            linkedParentNotesIds: [],
            linkedParentTasksIds: [],
            linkedParentContactsIds: [],
            linkedParentProjectsIds: [],
            linkedParentGoalsIds: [],
            linkedParentSkillsIds: [],
            linkedParentAssistantIds: [],
            linkedParentsInTitleIds: {},
            linkedParentsInContentIds: {},
            versionId: '-1',
            isVisibleInFollowedFor: [],
            followersIds: [],
            parentObject: null,
            isPremium: false,
            linkedToTemplate: false,
            assistantId: '',
            commentsData: null,
        })
        await poll(async () => (await getDoc(`noteItems/${projectId}/notes/${noteId}`))?.readerIds?.includes(uid), {
            timeout: 30000,
        })
        await page.goto(`${APP}/projects/${projectId}/notes/${noteId}/editor`, { waitUntil: 'domcontentloaded' })
        const noteEditor = page.locator('.ql-editor').first()
        await noteEditor.waitFor({ timeout: 60000 })
        await poll(async () => (await noteEditor.getAttribute('contenteditable')) === 'true', { timeout: 60000 })
        await noteEditor.click()
        await page.keyboard.type(`Numbers: ${APP}/projects/${projectId}/artifacts/${artifact.id} `)
        const chip = await poll(
            async () => {
                const locator = page.locator('.ql-editor .ql-url').first()
                return (await locator.count()) > 0 ? locator : null
            },
            { timeout: 30000 }
        )
        check('a pasted artifact address becomes a link chip in the note', !!chip)
        if (chip) {
            // The chip resolves its title from the artifact asynchronously.
            const chipText = await poll(
                async () => {
                    const text = await chip.innerText()
                    return text.includes('Team dashboard 2026') ? text : null
                },
                { timeout: 20000 }
            )
            await shot(page, '08a-note-chip')
            check('the chip is named after the artifact', !!chipText, await chip.innerText())
            await chip.click()
            await page.getByTestId('artifact-link-show-preview').click({ timeout: 15000 })
            const card = await poll(
                async () => ((await page.getByTestId(`artifact-embed-${artifact.id}`).count()) > 0 ? true : null),
                { timeout: 30000 }
            )
            check('"Show as preview" turns the chip into a live card', !!card)
            const cardFrame = await poll(
                () =>
                    page.frames().find(frame => frame.url().includes('alldone-bridge=1') && frame !== page.mainFrame()),
                { timeout: 30000 }
            )
            const cardStatus = cardFrame
                ? await poll(
                      async () => {
                          const text = await cardFrame.locator('#status').textContent({ timeout: 2000 })
                          return text && text.startsWith('live:') ? text : null
                      },
                      { timeout: 30000 }
                  )
                : null
            check('the card runs the live dashboard inside the note', !!cardStatus, cardStatus)
            await shot(page, '08-note-card')

            const noteBacklink = await poll(
                async () => {
                    const note = await getDoc(`noteItems/${projectId}/notes/${noteId}`)
                    return note?.linkedParentArtifactsIds?.includes(artifact.id) ? note.linkedParentArtifactsIds : null
                },
                { timeout: 60000 }
            )
            check('the note records the artifact as a backlink', !!noteBacklink, noteBacklink)
        }

        const fatal = pageErrors.filter(message => !/auth\/network-request-failed|ResizeObserver/.test(message))
        check('no uncaught errors in the app', fatal.length === 0, fatal.slice(0, 5))
    } catch (error) {
        console.error(error)
        await shot(page, 'zz-failure')
        check('the run completed', false, String(error?.message || error))
    } finally {
        await browser.close()
    }

    const failed = results.filter(result => !result.pass).length
    console.log(`\n${results.length - failed}/${results.length} checks passed — screenshots in ${SHOTS}`)
    process.exit(failed ? 1 : 0)
}

main()
