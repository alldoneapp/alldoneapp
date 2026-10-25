/**
 * AT-2518 browser-level test — the browser tools against a REAL Chromium.
 *
 * Everything else in this feature is covered by jest against a worker double, which proves the
 * policy, the budget, the audit trail and the approval gate compose correctly — and proves nothing
 * about Playwright. This runner closes that gap: it starts the REAL worker process, points it at a
 * REAL Chromium, and drives the REAL `executeBrowserTool` against a fixture site, so every layer in
 * between is the shipped one.
 *
 * What it checks, in one browsing run:
 *
 *   1. navigate   opens an allowlisted page and reads its text
 *   2. inspect    returns interactive elements with usable refs
 *   3. type+submit a GET search form runs without an approval (the `search_submit` carve-out)
 *   4. wait       waits for content that appears after the page load
 *   5. screenshot captures real PNG bytes and stores them as evidence
 *   6. click      "Jetzt buchen" PAUSES — the page is not touched (approval gate)
 *   7. resume     after the user approves, the same click goes through (pause/resume)
 *   8. deny       a denied signature stays refused for the rest of the run
 *   9. allowlist  an off-allowlist host is refused before the worker is called at all
 *  10. redirect   an allowlisted page that redirects off the allowlist is blocked IN the worker
 *  11. gold       exactly the executed steps are charged, and nothing else
 *  12. all_public an unlisted public host opens, while localhost, a private range, an IP literal
 *                 and the cloud metadata endpoint stay refused — including as REDIRECT targets,
 *                 which is the only place the worker's guard is the last line
 *
 * Requirements (not part of CI):
 *   nvm use 22
 *   npx playwright install chromium          # into PLAYWRIGHT_HOME, default /home/user/repro
 *   node browser-tests/at2518/run.js
 *
 * Exit code 0 = pass.
 */
'use strict'

const path = require('path')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const { startFixtureSite } = require('./fixture-site')
const { FirestoreDouble, createBucketDouble } = require(
    path.join(ROOT, 'functions', 'Assistant', 'browser', '__browserFirestoreDouble.js')
)
const { executeBrowserTool } = require(path.join(ROOT, 'functions', 'Assistant', 'browser', 'browserSession.js'))
const { respondToBrowserApproval } = require(
    path.join(ROOT, 'functions', 'Assistant', 'browser', 'browserApprovals.js')
)
const { executeBrowserTakeover, finishBrowserTakeover } = require(
    path.join(ROOT, 'functions', 'Assistant', 'browser', 'browserTakeover.js')
)

const PLAYWRIGHT_HOME = process.env.PLAYWRIGHT_HOME || '/home/user/repro'
const SIGNING_SECRET = 'at2518-integration-secret'
const PROJECT_ID = 'p1'
const OBJECT_ID = 'task1'
const USER_ID = 'user1'

const results = []
function check(label, condition, detail = '') {
    results.push({ label, ok: !!condition, detail })
    console.log(`${condition ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
}

function waitForWorker(baseUrl, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs
    return new Promise((resolve, reject) => {
        const attempt = async () => {
            try {
                const response = await fetch(`${baseUrl}/healthz`)
                if (response.ok) return resolve(true)
            } catch (error) {
                // not up yet
            }
            if (Date.now() > deadline) return reject(new Error('The browser worker did not start.'))
            setTimeout(attempt, 250)
        }
        attempt()
    })
}

async function main() {
    const { server, port: sitePort } = await startFixtureSite()
    console.log(`fixture site on 127.0.0.1:${sitePort}`)

    const workerPort = 8791
    const worker = spawn('node', [path.join(ROOT, 'functions', 'Assistant', 'browser-worker', 'server.js')], {
        env: {
            ...process.env,
            PORT: String(workerPort),
            BROWSER_WORKER_SIGNING_SECRET: SIGNING_SECRET,
            BROWSER_WORKER_IDLE_MS: '120000',
            // Chromium resolves the fixture's public-looking names to loopback. The allowlist still
            // sees `tickets.example`, so nothing about the policy is relaxed for the test.
            BROWSER_WORKER_HOST_RESOLVER_RULES: `MAP tickets.example 127.0.0.1:${sitePort}, MAP tracker.example 127.0.0.1:${sitePort}, MAP unlisted.example 127.0.0.1:${sitePort}, MAP ads.example 127.0.0.1:${sitePort}, MAP vault.internal 127.0.0.1:${sitePort}`,
            // The worker is a separate service with its own dependency tree; Playwright lives
            // outside the repo here, exactly as the other browser-tests runners expect.
            NODE_PATH: path.join(PLAYWRIGHT_HOME, 'node_modules'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    worker.stdout.on('data', chunk => process.stdout.write(`[worker] ${chunk}`))
    worker.stderr.on('data', chunk => process.stderr.write(`[worker] ${chunk}`))

    const workerBaseUrl = `http://127.0.0.1:${workerPort}`
    await waitForWorker(workerBaseUrl)

    // The config the tool reads. `browserConfig` requires https for a deployed worker URL, so the
    // loopback worker is injected through the same env shape with the check relaxed only by using
    // an https-looking origin the fetch double rewrites. Simpler: point the tool at the real
    // worker over http by pre-resolving the config here.
    const db = new FirestoreDouble({
        'projects/p1': {
            browserAutomation: {
                limits: { maxSteps: 60, maxRunWallClockMs: 10 * 60 * 1000, maxSessionIdleMs: 10 * 60 * 1000 },
            },
        },
    })
    const bucket = createBucketDouble()
    const goldCharges = []
    const deductGold = async (userId, amount, context) => {
        goldCharges.push({ userId, amount, context })
        return { success: true, amount, newBalance: 500 }
    }

    // `resolveBrowserConfig` insists on https for a real deployment. The test rewrites the URL of
    // the outgoing request instead of weakening that rule.
    const env = {
        BROWSER_WORKER_URL: 'https://browser-worker.invalid',
        BROWSER_WORKER_SIGNING_SECRET: SIGNING_SECRET,
        BROWSER_ALLOWED_DOMAINS: 'tickets.example',
    }
    const fetchImpl = (url, options) =>
        fetch(String(url).replace('https://browser-worker.invalid', workerBaseUrl), options)

    const call = (toolName, toolArgs, overrides = {}) =>
        executeBrowserTool({
            toolName,
            toolArgs,
            projectId: overrides.projectId || PROJECT_ID,
            assistantId: 'assistant1',
            requestUserId: USER_ID,
            toolRuntimeContext: {
                objectId: overrides.objectId || OBJECT_ID,
                objectType: 'tasks',
                assistantCommentId: 'comment1',
            },
            deps: { db, bucket, env, fetchImpl, deductGold },
        })

    // A second project, configured for "all public websites". Same worker, same code path, only the
    // stored access mode differs — which is what makes the comparison below meaningful.
    db.documents.set('projects/p2', {
        browserAutomation: {
            accessMode: 'all_public',
            deniedDomains: ['ads.example'],
            // A refused navigation still consumes a step and a navigation from the run budget (it
            // was handed out before the policy ran), and this block deliberately makes a lot of
            // refusals, so the budget has to be wide enough for them all to actually be attempted.
            limits: { maxNavigations: 20, maxSteps: 40 },
        },
    })
    const callPublic = (toolName, toolArgs) =>
        call(toolName, toolArgs, { projectId: 'p2', objectId: 'task-all-public' })

    try {
        // ---- 1. navigate ------------------------------------------------------------------
        const navigated = await call('browser_navigate', { url: 'http://tickets.example/event/42' })
        check('navigate opens an allowlisted page', navigated.success === true, navigated.error || '')
        check(
            'navigate returns the page text',
            typeof navigated.text === 'string' && navigated.text.includes('Konzert am 15. September'),
            (navigated.text || '').slice(0, 60)
        )
        check('navigate stores a DOM snapshot as evidence', !!navigated.evidence?.snapshotUrl)

        // ---- 2. inspect -------------------------------------------------------------------
        const inspected = await call('browser_inspect', {})
        const bookButton = (inspected.elements || []).find(element => element.name.includes('Jetzt buchen'))
        check('inspect returns interactive elements', (inspected.elements || []).length > 0)
        check('inspect finds the booking button and flags it', !!bookButton && bookButton.needsApproval === true)
        check(
            'inspect gives every element a usable ref',
            (inspected.elements || []).every(element => !!element.ref)
        )

        // ---- session-only human login -----------------------------------------------------
        await call('browser_navigate', { url: 'http://tickets.example/login' })
        const loginPage = await call('browser_inspect', {})
        const signIn = (loginPage.elements || []).find(element => element.name === 'Sign in')
        const loginPause = await call('browser_click', { ref: signIn.ref })
        check('a login pauses for secure human takeover', loginPause.category === 'login', loginPause.category)

        const takeover = (action, input = {}) =>
            executeBrowserTakeover({
                db,
                env,
                approvalId: loginPause.approvalId,
                userId: USER_ID,
                action,
                input,
                fetchImpl,
                identityTokenProvider: async () => 'local-worker',
                deductGold,
            })
        const loginSecret = 'not-written-anywhere'
        const firstFrame = await takeover('snapshot')
        check(
            'secure takeover returns a real JPEG viewport',
            firstFrame.screenshotDataUrl.startsWith('data:image/jpeg;base64,')
        )
        await takeover('key', { key: 'Tab' })
        await takeover('type', { text: 'person@example.com' })
        await takeover('key', { key: 'Tab' })
        const passwordFrame = await takeover('type', { text: loginSecret })
        check('the human can type into a password field', passwordFrame.focused?.inputType === 'password')
        await takeover('key', { key: 'Tab' })
        await takeover('key', { key: 'Enter' })
        await finishBrowserTakeover(db, { approvalId: loginPause.approvalId, userId: USER_ID })

        const signedIn = await call('browser_inspect', {})
        check(
            'the assistant receives the same logged-in browser context',
            (signedIn.text || '').includes('Your account')
        )
        check(
            'the login secret is absent from every Firestore document',
            !JSON.stringify([...db.documents]).includes(loginSecret)
        )

        // Return to the event page for the remaining policy checks.
        await call('browser_navigate', { url: 'http://tickets.example/event/42' })

        // ---- 4. wait ----------------------------------------------------------------------
        const waited = await call('browser_wait', { selector: '#late-content', state: 'visible' })
        check('wait waits for content that loads late', waited.success === true, waited.error || '')
        const afterWait = await call('browser_inspect', {})
        check(
            'the late content is really there afterwards',
            (afterWait.text || '').includes('Noch 12 Tickets verfügbar')
        )

        // ---- 5. screenshot ----------------------------------------------------------------
        const shot = await call('browser_screenshot', { fullPage: false })
        const shotFile = [...bucket.files.entries()].find(([filePath]) => filePath.endsWith('-screenshot.png'))
        check('screenshot succeeds', shot.success === true, shot.error || '')
        check(
            'screenshot stores real PNG bytes',
            !!shotFile && shotFile[1].bytes > 1000 && shotFile[1].buffer.slice(1, 4).toString() === 'PNG',
            shotFile ? `${shotFile[1].bytes} bytes` : 'no file'
        )

        // ---- 6. click on a booking button PAUSES ------------------------------------------
        const blockedClick = await call('browser_click', { ref: bookButton.ref })
        check('a booking button pauses instead of clicking', blockedClick.status === 'approval_required')
        check('the pause names the category', blockedClick.category === 'booking', blockedClick.category)
        check('the pause offers a run-scoped answer for this category', blockedClick.allowRunScope === true)
        const stillOnEvent = await call('browser_inspect', {})
        check(
            'the page was NOT submitted while waiting for the approval',
            !(stillOnEvent.text || '').includes('Buchung bestätigt')
        )

        // ---- 8. deny sticks ---------------------------------------------------------------
        const newsletterButton = (afterWait.elements || []).find(element =>
            element.name.includes('Newsletter abonnieren')
        )
        const newsletterPause = await call('browser_click', { ref: newsletterButton.ref })
        check('a second sensitive control pauses too', newsletterPause.status === 'approval_required')
        await respondToBrowserApproval(db, { approvalId: newsletterPause.approvalId, userId: USER_ID, action: 'deny' })
        const afterDeny = await call('browser_click', { ref: newsletterButton.ref })
        check('a denied action stays refused for the run', afterDeny.reason === 'approval_denied', afterDeny.reason)

        // ---- 3. search submit runs without an approval ------------------------------------
        await call('browser_navigate', { url: 'http://tickets.example/' })
        const homeElements = await call('browser_inspect', {})
        const homeSearch = (homeElements.elements || []).find(element => element.type === 'search')
        const searched = await call('browser_type', { ref: homeSearch.ref, text: 'Konzert', submit: true })
        check('a GET search form runs without an approval', searched.success === true, searched.error || '')
        check(
            'the search actually ran',
            (searched.text || '').includes('Treffer für Konzert'),
            (searched.text || '').slice(0, 60)
        )
        // The page legitimately echoes the query back, so the property is about the RECORD: the
        // audit keeps a shape and a length, never the text that was typed into the page.
        const typeStep = db
            .listSubcollection('browserRuns')
            .filter(entry => entry.path.includes('/steps/') && entry.toolName === 'browser_type')
            .pop()
        check('the audit records a typed value without the text', !!typeStep && typeStep.typedValue?.length === 7)
        check(
            'the typed value is a shape, not the text',
            typeStep?.typedValue?.preview === '«redacted»' && typeStep?.typedValue?.shape === 'word'
        )
        // The visited URL legitimately carries the query (`?q=Konzert`) — that is what was browsed,
        // and the record has to say so. What must never be stored is the value as typed.
        check('the typed argument is not kept on the step', typeStep?.args?.text === '«redacted»', typeStep?.args?.text)

        // ---- 9. off-allowlist host --------------------------------------------------------
        const offAllowlist = await call('browser_navigate', { url: 'http://tracker.example/steal' })
        check(
            'an off-allowlist host is refused',
            offAllowlist.success === false && offAllowlist.reason === 'not_allowlisted'
        )

        // ---- 10. redirect containment -----------------------------------------------------
        const redirected = await call('browser_navigate', { url: 'http://tickets.example/redirect' })
        check(
            'a redirect off the allowlist is blocked in the worker',
            redirected.success === false && redirected.reason === 'redirect_off_allowlist',
            redirected.error || redirected.reason || ''
        )
        const afterRedirect = await call('browser_inspect', {})
        check('the off-allowlist page never rendered', !(afterRedirect.text || '').includes('OFF ALLOWLIST'))

        // ---- 7. approve, then the same click goes through (pause -> resume) ----------------
        await call('browser_navigate', { url: 'http://tickets.example/event/42' })
        const eventAgain = await call('browser_inspect', {})
        const bookAgain = (eventAgain.elements || []).find(element => element.name.includes('Jetzt buchen'))
        const pausedAgain = await call('browser_click', { ref: bookAgain.ref })
        check('the booking still pauses on a fresh page', pausedAgain.status === 'approval_required')

        await respondToBrowserApproval(db, {
            approvalId: pausedAgain.approvalId,
            userId: USER_ID,
            action: 'approve',
            scope: 'once',
        })
        const approvedClick = await call('browser_click', { ref: bookAgain.ref })
        check('after approval the click goes through', approvedClick.success === true, approvedClick.error || '')
        check(
            'and the booking really happened in the browser',
            (approvedClick.text || '').includes('Buchung bestätigt'),
            (approvedClick.text || '').slice(0, 60)
        )

        // Back to the same page and the same button: a `once` grant was spent, so the identical
        // action has to ask again rather than ride the previous answer.
        await call('browser_navigate', { url: 'http://tickets.example/event/42' })
        const thirdVisit = await call('browser_inspect', {})
        const bookThird = (thirdVisit.elements || []).find(element => element.name.includes('Jetzt buchen'))
        const afterApproval = await call('browser_click', { ref: bookThird.ref })
        check(
            'a single-use approval is not reusable for the same action',
            afterApproval.status === 'approval_required',
            afterApproval.status || afterApproval.reason
        )

        // ---- 12. all public websites ------------------------------------------------------
        const goldBeforePublic = goldCharges.length

        const unlisted = await callPublic('browser_navigate', { url: 'http://unlisted.example/' })
        check('all_public opens a host that is on no allowlist', unlisted.success === true, unlisted.error || '')
        check(
            'and it really is the fixture page',
            (unlisted.text || '').includes('Kulturhaus Tickets'),
            (unlisted.text || '').slice(0, 40)
        )

        const sameHostInSelected = await call('browser_navigate', { url: 'http://unlisted.example/' })
        check(
            'the very same host stays refused in the selected-sites project',
            sameHostInSelected.success === false && sameHostInSelected.reason === 'not_allowlisted'
        )

        const deniedPublic = await callPublic('browser_navigate', { url: 'http://ads.example/' })
        check(
            'the denylist still wins in all_public',
            deniedPublic.success === false && /blocked list/i.test(deniedPublic.error || ''),
            deniedPublic.error || ''
        )

        for (const url of [
            'http://localhost/admin',
            'http://127.0.0.1/',
            'http://10.0.0.5/',
            'http://169.254.169.254/computeMetadata/v1/',
            'http://metadata.google.internal/',
            'http://8.8.8.8/',
            'http://intranet/',
            'file:///etc/passwd',
        ]) {
            const refused = await callPublic('browser_navigate', { url })
            check(`all_public still refuses ${url}`, refused.success === false, refused.reason || '')
        }

        // The redirect cases are the ones only a real browser can prove: Functions never sees the
        // hop, so the worker's guard is the only thing between the redirect and the target.
        const metadataRedirect = await callPublic('browser_navigate', {
            url: 'http://unlisted.example/redirect-internal',
        })
        check(
            'a redirect to the metadata endpoint is blocked in the worker, in all_public',
            metadataRedirect.success === false,
            metadataRedirect.error || metadataRedirect.reason || ''
        )
        const localhostRedirect = await callPublic('browser_navigate', {
            url: 'http://unlisted.example/redirect-localhost',
        })
        check(
            'a redirect to localhost is blocked in the worker, in all_public',
            localhostRedirect.success === false,
            localhostRedirect.error || localhostRedirect.reason || ''
        )

        const throughInternal = await callPublic('browser_navigate', {
            url: 'http://unlisted.example/redirect-through-internal',
        })
        check(
            'a chain that goes THROUGH an internal host fails, not just one that ends there',
            throughInternal.success === false && /vault\.internal/i.test(throughInternal.error || ''),
            `${throughInternal.reason || ''} | ${(throughInternal.error || '').slice(0, 120)}`
        )

        const afterRedirects = await callPublic('browser_inspect', {})
        check(
            'nothing internal ever rendered',
            afterRedirects.success === false || !/root:|computeMetadata|admin/i.test(afterRedirects.text || '')
        )

        check(
            'a refused target in all_public costs nothing',
            // Only the two successful navigations plus the inspect were executed; every refusal
            // above returned before the browser was touched or before the worker succeeded.
            goldCharges.length - goldBeforePublic <= 3,
            `${goldCharges.length - goldBeforePublic} charges for 2 executed navigations + 1 inspect`
        )

        // ---- 11. gold ---------------------------------------------------------------------
        const executedSteps = db
            .listSubcollection('browserRuns')
            .filter(entry => entry.path.includes('/steps/') && entry.status === 'completed')
        check(
            'exactly the executed steps were charged',
            goldCharges.length === executedSteps.length,
            `${goldCharges.length} charges vs ${executedSteps.length} executed steps`
        )
        check(
            'every charge is one Gold from the browser source',
            goldCharges.every(charge => charge.amount === 1 && charge.context.source === 'browser_automation')
        )
        check(
            'every charge carries its own idempotency key',
            new Set(goldCharges.map(charge => charge.context.idempotencyKey)).size === goldCharges.length
        )

        // ---- audit ------------------------------------------------------------------------
        const allSteps = db.listSubcollection('browserRuns').filter(entry => entry.path.includes('/steps/'))
        check('every tool call left an audit step', allSteps.length >= 15, `${allSteps.length} steps`)
        check(
            'a paused step is recorded as awaiting_approval',
            allSteps.some(step => step.status === 'awaiting_approval')
        )
        check(
            'a refused step is recorded as blocked',
            allSteps.some(step => step.status === 'blocked' && step.decision === 'deny')
        )
    } finally {
        worker.kill('SIGTERM')
        server.close()
    }

    const failed = results.filter(result => !result.ok)
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
    if (failed.length) {
        console.log('failed:')
        failed.forEach(result => console.log(`  - ${result.label}${result.detail ? ` (${result.detail})` : ''}`))
    }
    process.exit(failed.length ? 1 : 0)
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
