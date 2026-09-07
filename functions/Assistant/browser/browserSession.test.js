'use strict'

// End-to-end over the real orchestrator with a fake worker, a fake Firestore and a fake bucket.
// These are the cases the feature is judged on: the allowlist actually stops a call, a limit
// actually stops a call, a sensitive action actually stops WITHOUT touching the page, and every one
// of those leaves an audit record with its evidence.

const { FirestoreDouble, createBucketDouble } = require('./__browserFirestoreDouble')
const { executeBrowserTool } = require('./browserSession')
const { respondToBrowserApproval } = require('./browserApprovals')
const { verifyWorkerToken } = require('./browserWorkerClient')

const NOW = 1_800_000_000_000
const SECRET = 'browser-worker-signing-secret'

const ENV = {
    BROWSER_WORKER_URL: 'https://browser-worker.example',
    BROWSER_WORKER_SIGNING_SECRET: SECRET,
    BROWSER_ALLOWED_DOMAINS: 'tickets.example, shop.example',
}

function createWorkerDouble(handlers = {}) {
    const calls = []
    const fetchImpl = async (url, options) => {
        const operation = String(url).split('/').pop()
        const body = JSON.parse(options.body)
        const token = String(options.headers.Authorization || '').replace('Bearer ', '')
        calls.push({ operation, body, token, action: body.action })

        const handler = handlers[operation === 'act' ? body.action || 'act' : operation]
        const result = handler ? await handler(body) : { ok: true }
        const status = result.status || (result.ok === false ? 422 : 200)
        return {
            ok: status >= 200 && status < 300,
            status,
            json: async () => result,
        }
    }
    return { fetchImpl, calls }
}

function pageResult(overrides = {}) {
    return {
        ok: true,
        url: 'https://tickets.example/event/42',
        finalUrl: 'https://tickets.example/event/42',
        httpStatus: 200,
        title: 'Konzert am 15. September',
        text: 'Noch 12 Tickets verfügbar.',
        elements: [{ ref: 'e1', role: 'button', name: 'Jetzt buchen', isSubmit: true }],
        snapshot: { url: 'https://tickets.example/event/42', elements: [] },
        usage: { networkRequests: 14, responseBytes: 250000 },
        ...overrides,
    }
}

function bookingTarget(overrides = {}) {
    return {
        ok: true,
        pageUrl: 'https://tickets.example/event/42',
        target: {
            tagName: 'button',
            role: 'button',
            name: 'Jetzt buchen',
            isSubmit: true,
            formMethod: 'post',
            submitLabels: ['Jetzt buchen'],
            ...overrides,
        },
    }
}

function createLedgerDouble() {
    const charges = []
    const deductGold = async (userId, amount, context) => {
        charges.push({ userId, amount, context })
        return { success: true, amount, newBalance: 99 }
    }
    return { deductGold, charges }
}

async function run(overrides = {}) {
    const db = overrides.db || new FirestoreDouble()
    const bucket = overrides.bucket || createBucketDouble()
    const worker = overrides.worker || createWorkerDouble()
    const ledger = overrides.ledger || createLedgerDouble()
    const result = await executeBrowserTool({
        toolName: overrides.toolName || 'browser_navigate',
        toolArgs: overrides.toolArgs || { url: 'https://tickets.example/event/42' },
        projectId: 'p1',
        assistantId: 'assistant1',
        requestUserId: 'user1',
        toolRuntimeContext: { objectId: 'task1', objectType: 'tasks' },
        deps: {
            db,
            bucket,
            env: overrides.env || ENV,
            fetchImpl: worker.fetchImpl,
            identityTokenProvider: async () => 'google-cloud-run-id-token',
            deductGold: ledger.deductGold,
            now: () => overrides.now || NOW,
        },
    })
    return { result, db, bucket, worker, ledger }
}

function auditSteps(db) {
    return db.listSubcollection('browserRuns').filter(entry => entry.path.includes('/steps/'))
}

describe('executeBrowserTool', () => {
    describe('configuration', () => {
        it('refuses everything when no site is allowlisted, and says so', async () => {
            const worker = createWorkerDouble()
            const { result, db } = await run({
                env: { ...ENV, BROWSER_ALLOWED_DOMAINS: '' },
                worker,
            })
            expect(result.success).toBe(false)
            expect(result.reason).toBe('browser_not_configured')
            // Names both ways out — add sites, or switch the mode — because they are different
            // decisions and an operator who hears only the first may not know the second exists.
            expect(result.error).toMatch(/only selected websites and none have been added/i)
            expect(result.error).toMatch(/all public websites/i)
            expect(worker.calls).toHaveLength(0)
            expect(db.listCollection('browserRuns')).toHaveLength(0)
        })

        it('refuses when the worker is not deployed', async () => {
            const { result } = await run({ env: { ...ENV, BROWSER_WORKER_URL: '' } })
            expect(result.success).toBe(false)
            expect(result.error).toMatch(/browser worker is not configured/i)
        })

        it('honours a project switching browsing off', async () => {
            const db = new FirestoreDouble({ 'projects/p1': { browserAutomation: { enabled: false } } })
            const { result } = await run({ db })
            expect(result.success).toBe(false)
            expect(result.error).toMatch(/switched off for this project/i)
        })

        it('lets a project add its own allowlisted host', async () => {
            const db = new FirestoreDouble({
                'projects/p1': { browserAutomation: { allowedDomains: ['kulturhaus.example'] } },
            })
            const worker = createWorkerDouble({ navigate: () => pageResult({ url: 'https://kulturhaus.example/' }) })
            const { result } = await run({ db, worker, toolArgs: { url: 'https://kulturhaus.example/' } })
            expect(result.success).toBe(true)
        })
    })

    describe('access modes', () => {
        const allPublicProject = extra => ({
            'projects/p1': { browserAutomation: { accessMode: 'all_public', ...extra } },
        })

        it('is "selected" unless the project says otherwise, whatever the stored value looks like', async () => {
            for (const accessMode of [undefined, 'selected', 'ALL_PUBLIC', 'everything', true]) {
                const db = new FirestoreDouble({ 'projects/p1': { browserAutomation: { accessMode } } })
                const worker = createWorkerDouble({ navigate: () => pageResult() })
                const { result } = await run({ db, worker, toolArgs: { url: 'https://unlisted.example/' } })
                expect(result.reason).toBe('not_allowlisted')
            }
        })

        it('opens an unlisted public host in all_public, and the WORKER is told so in the signed token', async () => {
            const db = new FirestoreDouble(allPublicProject())
            const worker = createWorkerDouble({ navigate: () => pageResult({ url: 'https://unlisted.example/' }) })
            const { result } = await run({ db, worker, toolArgs: { url: 'https://unlisted.example/' } })

            expect(result.success).toBe(true)
            // Without the mode in the token the worker's own guard would abort the very navigation
            // Functions just permitted — and a client cannot forge it, because the token is signed.
            const verified = verifyWorkerToken(worker.calls[0].token, SECRET, NOW)
            expect(verified.accessMode).toBe('all_public')
        })

        it('needs no allowlist at all in all_public', async () => {
            const db = new FirestoreDouble(allPublicProject())
            const worker = createWorkerDouble({ navigate: () => pageResult({ url: 'https://unlisted.example/' }) })
            const { result } = await run({
                db,
                worker,
                env: { ...ENV, BROWSER_ALLOWED_DOMAINS: '' },
                toolArgs: { url: 'https://unlisted.example/' },
            })
            expect(result.success).toBe(true)
        })

        it.each([
            'http://localhost:8080/',
            'http://127.0.0.1/',
            'http://10.0.0.5/',
            'http://169.254.169.254/computeMetadata/v1/',
            'http://metadata.google.internal/',
            'http://[fd00::1]/',
            'http://intranet/',
            'http://wiki.internal/',
            'file:///etc/passwd',
            'ftp://example.com/',
        ])('still refuses %s in all_public, before the worker is called', async url => {
            const db = new FirestoreDouble(allPublicProject())
            const worker = createWorkerDouble({ navigate: () => pageResult() })
            const { result } = await run({ db, worker, toolArgs: { url } })

            expect(result.success).toBe(false)
            expect(worker.calls).toHaveLength(0)
        })

        it('honours the project denylist in all_public', async () => {
            const db = new FirestoreDouble(allPublicProject({ deniedDomains: ['ads.example', '*.tracker.example'] }))
            const worker = createWorkerDouble({ navigate: () => pageResult({ url: 'https://ads.example/' }) })

            const blocked = await run({ db, worker, toolArgs: { url: 'https://ads.example/' } })
            expect(blocked.result.success).toBe(false)
            expect(blocked.result.error).toMatch(/blocked list/i)
            expect(worker.calls).toHaveLength(0)

            const allowed = await run({ db, worker, toolArgs: { url: 'https://unlisted.example/' } })
            expect(allowed.result.success).toBe(true)
        })

        it('carries the denylist into the worker token as well', async () => {
            const db = new FirestoreDouble(allPublicProject({ deniedDomains: ['ads.example'] }))
            const worker = createWorkerDouble({ navigate: () => pageResult({ url: 'https://unlisted.example/' }) })
            await run({ db, worker, toolArgs: { url: 'https://unlisted.example/' } })

            const verified = verifyWorkerToken(worker.calls[0].token, SECRET, NOW)
            expect(verified.denylist.map(entry => entry.host)).toEqual(['ads.example'])
        })

        it('still charges exactly one Gold per executed step, and nothing for a mode refusal', async () => {
            const db = new FirestoreDouble(allPublicProject({ deniedDomains: ['ads.example'] }))
            const worker = createWorkerDouble({ navigate: () => pageResult({ url: 'https://unlisted.example/' }) })
            const ledger = createLedgerDouble()

            await run({ db, worker, ledger, toolArgs: { url: 'https://unlisted.example/' } })
            expect(ledger.charges).toHaveLength(1)
            expect(ledger.charges[0].amount).toBe(1)

            await run({ db, worker, ledger, toolArgs: { url: 'https://ads.example/' } })
            await run({ db, worker, ledger, toolArgs: { url: 'http://169.254.169.254/' } })
            expect(ledger.charges).toHaveLength(1)
        })
    })

    describe('navigate', () => {
        it('opens an allowlisted page and records the run, the step and the evidence', async () => {
            const worker = createWorkerDouble({ navigate: () => pageResult() })
            const { result, db, bucket } = await run({ worker })

            expect(result.success).toBe(true)
            expect(result.title).toBe('Konzert am 15. September')
            expect(result.elements[0]).toMatchObject({ ref: 'e1', needsApproval: true })

            const runs = db.listCollection('browserRuns')
            expect(runs).toHaveLength(1)
            expect(runs[0].budget).toMatchObject({ steps: 1, navigations: 1, networkRequests: 14 })

            const steps = auditSteps(db)
            expect(steps).toHaveLength(1)
            expect(steps[0]).toMatchObject({ toolName: 'browser_navigate', status: 'completed', decision: 'allow' })
            expect(steps[0].evidence.snapshotSha256).toEqual(expect.any(String))
            expect([...bucket.files.keys()].some(path => path.endsWith('-snapshot.json'))).toBe(true)
        })

        it('refuses an off-allowlist URL without ever calling the worker, and records the refusal', async () => {
            const worker = createWorkerDouble({ navigate: () => pageResult() })
            const { result, db } = await run({ worker, toolArgs: { url: 'https://elsewhere.example/' } })

            expect(result.success).toBe(false)
            expect(result.reason).toBe('not_allowlisted')
            expect(worker.calls).toHaveLength(0)
            const steps = auditSteps(db)
            expect(steps[0]).toMatchObject({ status: 'blocked', decision: 'deny', decisionReason: 'not_allowlisted' })
        })

        it('hands the worker a token carrying the allowlist and the limits, not a bare identity', async () => {
            const worker = createWorkerDouble({ navigate: () => pageResult() })
            await run({ worker })
            const verified = verifyWorkerToken(worker.calls[0].token, SECRET, NOW)
            expect(verified.valid).toBe(true)
            expect(verified.allowlist.map(entry => entry.host)).toEqual(['tickets.example', 'shop.example'])
            expect(verified.limits.requests).toBeGreaterThan(0)
        })

        it('redacts a credential that happens to be printed on the page', async () => {
            const worker = createWorkerDouble({
                navigate: () => pageResult({ text: 'Debug token ghp_abcdefghijklmnopqrstuvwxyz012345' }),
            })
            const { result } = await run({ worker })
            expect(result.text).not.toMatch(/ghp_/)
        })

        it('reports a worker failure as a page problem rather than throwing', async () => {
            const worker = createWorkerDouble({
                navigate: () => ({ ok: false, reason: 'redirect_off_allowlist', error: 'The page redirected away.' }),
            })
            const { result, db } = await run({ worker })
            expect(result.success).toBe(false)
            expect(result.reason).toBe('redirect_off_allowlist')
            expect(auditSteps(db)[0].status).toBe('failed')
        })
    })

    describe('session', () => {
        it('refuses an action when no page is open', async () => {
            const { result, worker } = await run({ toolName: 'browser_inspect', toolArgs: {} })
            expect(result.success).toBe(false)
            expect(result.reason).toBe('no_session')
            expect(worker.calls).toHaveLength(0)
        })

        it('re-uses the same run for the next tool call in the thread', async () => {
            const db = new FirestoreDouble()
            const worker = createWorkerDouble({ navigate: () => pageResult(), inspect: () => pageResult() })
            await run({ db, worker })
            await run({ db, worker, toolName: 'browser_inspect', toolArgs: {} })
            expect(db.listCollection('browserRuns')).toHaveLength(1)
            expect(auditSteps(db)).toHaveLength(2)
        })
    })

    describe('limits', () => {
        it('stops the run at its navigation limit and closes the worker session', async () => {
            const db = new FirestoreDouble({
                'projects/p1': { browserAutomation: { limits: { maxNavigations: 1 } } },
            })
            const worker = createWorkerDouble({ navigate: () => pageResult(), close: () => ({ ok: true }) })
            await run({ db, worker })
            const { result } = await run({ db, worker })

            expect(result.success).toBe(false)
            expect(result.reason).toBe('limit_exceeded')
            expect(worker.calls.filter(call => call.operation === 'close')).toHaveLength(1)
            // The run says it ended at a limit rather than simply stopping after its last success.
            const runDocument = db.listCollection('browserRuns')[0]
            expect(runDocument.status).toBe('aborted')
            expect(runDocument.lastViolation.counter).toBe('navigations')
        })

        it('charges what the worker reports it downloaded', async () => {
            const db = new FirestoreDouble()
            const worker = createWorkerDouble({ navigate: () => pageResult() })
            await run({ db, worker })
            expect(db.listCollection('browserRuns')[0].budget.responseBytes).toBe(250000)
        })
    })

    describe('approval gates', () => {
        it('does NOT touch the page for a booking button, and raises a request instead', async () => {
            const worker = createWorkerDouble({ navigate: () => pageResult(), describe: () => bookingTarget() })
            const db = new FirestoreDouble()
            await run({ db, worker })
            const { result } = await run({ db, worker, toolName: 'browser_click', toolArgs: { ref: 'e1' } })

            expect(result.status).toBe('approval_required')
            expect(result.category).toBe('booking')
            expect(result.approvalId).toEqual(expect.any(String))
            // The page was described, never clicked.
            expect(worker.calls.map(call => call.operation)).toEqual(['act', 'describe'])

            const approvals = db.listCollection('browserApprovals')
            expect(approvals).toHaveLength(1)
            expect(approvals[0]).toMatchObject({ status: 'pending', category: 'booking', requestUserId: 'user1' })
            expect(auditSteps(db).pop()).toMatchObject({ status: 'awaiting_approval', decision: 'requires_approval' })
        })

        it('performs the action once the user approves, and asks again the next time', async () => {
            const worker = createWorkerDouble({
                navigate: () => pageResult(),
                describe: () => bookingTarget(),
                click: () => pageResult({ url: 'https://tickets.example/checkout' }),
            })
            const db = new FirestoreDouble()
            await run({ db, worker })
            const first = await run({ db, worker, toolName: 'browser_click', toolArgs: { ref: 'e1' } })

            await respondToBrowserApproval(db, {
                approvalId: first.result.approvalId,
                userId: 'user1',
                action: 'approve',
                now: NOW,
            })

            const approved = await run({ db, worker, toolName: 'browser_click', toolArgs: { ref: 'e1' } })
            expect(approved.result.success).toBe(true)
            expect(worker.calls.filter(call => call.action === 'click')).toHaveLength(1)

            const again = await run({ db, worker, toolName: 'browser_click', toolArgs: { ref: 'e1' } })
            expect(again.result.status).toBe('approval_required')
            expect(worker.calls.filter(call => call.action === 'click')).toHaveLength(1)
        })

        it('does not re-ask after the user declined, and tells the model to stop', async () => {
            const worker = createWorkerDouble({ navigate: () => pageResult(), describe: () => bookingTarget() })
            const db = new FirestoreDouble()
            await run({ db, worker })
            const first = await run({ db, worker, toolName: 'browser_click', toolArgs: { ref: 'e1' } })
            await respondToBrowserApproval(db, {
                approvalId: first.result.approvalId,
                userId: 'user1',
                action: 'deny',
                now: NOW,
            })

            const after = await run({ db, worker, toolName: 'browser_click', toolArgs: { ref: 'e1' } })
            expect(after.result.reason).toBe('approval_denied')
            expect(after.result.error).toMatch(/do not try it again/i)
            expect(db.listCollection('browserApprovals')).toHaveLength(1)
        })

        it('refuses the action when the element cannot be observed', async () => {
            const worker = createWorkerDouble({
                navigate: () => pageResult(),
                describe: () => ({ ok: false, reason: 'target_unresolved', error: 'The element is gone.' }),
                click: () => pageResult(),
            })
            const db = new FirestoreDouble()
            await run({ db, worker })
            const { result } = await run({ db, worker, toolName: 'browser_click', toolArgs: { ref: 'e99' } })

            expect(result.success).toBe(false)
            expect(result.reason).toBe('target_unresolved')
            expect(worker.calls.filter(call => call.action === 'click')).toHaveLength(0)
        })

        it('never types a credential, whatever the field is called', async () => {
            const worker = createWorkerDouble({
                navigate: () => pageResult(),
                describe: () => ({
                    ok: true,
                    pageUrl: 'https://tickets.example/event/42',
                    target: { tagName: 'input', role: 'textbox', fieldName: 'q', formMethod: 'get' },
                }),
                type: () => pageResult(),
            })
            const db = new FirestoreDouble()
            await run({ db, worker })
            const { result } = await run({
                db,
                worker,
                toolName: 'browser_type',
                toolArgs: { ref: 'e2', text: 'ghp_abcdefghijklmnopqrstuvwxyz0123' },
            })

            expect(result.success).toBe(false)
            expect(result.reason).toBe('secret_in_input')
            expect(worker.calls.filter(call => call.action === 'type')).toHaveLength(0)
        })

        it('allows an ordinary search and never records what was typed', async () => {
            const worker = createWorkerDouble({
                navigate: () => pageResult(),
                describe: () => ({
                    ok: true,
                    pageUrl: 'https://tickets.example/event/42',
                    target: {
                        tagName: 'input',
                        role: 'searchbox',
                        inputType: 'search',
                        fieldName: 'q',
                        formMethod: 'get',
                    },
                }),
                type: () => pageResult(),
            })
            const db = new FirestoreDouble()
            await run({ db, worker })
            const { result } = await run({
                db,
                worker,
                toolName: 'browser_type',
                toolArgs: { ref: 'e2', text: 'Konzert 15. September', submit: true },
            })

            expect(result.success).toBe(true)
            expect(result.typed).toMatchObject({ length: 21, looksSecret: false })

            const step = auditSteps(db).pop()
            expect(JSON.stringify(step)).not.toContain('Konzert 15. September')
            expect(step.typedValue).toMatchObject({ length: 21 })
        })
    })

    describe('gold', () => {
        it('charges exactly one step, keyed on the step id', async () => {
            const worker = createWorkerDouble({ navigate: () => pageResult() })
            const ledger = createLedgerDouble()
            const { db } = await run({ worker, ledger })

            expect(ledger.charges).toHaveLength(1)
            expect(ledger.charges[0].amount).toBe(1)
            expect(ledger.charges[0].context.source).toBe('browser_automation')

            const step = auditSteps(db)[0]
            expect(ledger.charges[0].context.idempotencyKey).toBe(`browser_step:${step.stepId}`)
            expect(step.goldCharged).toBe(true)
        })

        it('charges nothing for a step the POLICY refused', async () => {
            // Billing the user for the protection working is the one outcome that would make people
            // switch it off.
            const ledger = createLedgerDouble()
            const { result } = await run({ ledger, toolArgs: { url: 'https://elsewhere.example/' } })
            expect(result.success).toBe(false)
            expect(ledger.charges).toHaveLength(0)
        })

        it('charges nothing for a step that paused for an approval', async () => {
            const worker = createWorkerDouble({ navigate: () => pageResult(), describe: () => bookingTarget() })
            const db = new FirestoreDouble()
            const ledger = createLedgerDouble()
            await run({ db, worker, ledger })
            const chargesAfterNavigate = ledger.charges.length

            const { result } = await run({ db, worker, ledger, toolName: 'browser_click', toolArgs: { ref: 'e1' } })
            expect(result.status).toBe('approval_required')
            expect(ledger.charges).toHaveLength(chargesAfterNavigate)
        })

        it('charges nothing when the worker failed', async () => {
            const worker = createWorkerDouble({
                navigate: () => ({ ok: false, reason: 'timeout', error: 'The page did not respond.' }),
            })
            const ledger = createLedgerDouble()
            const { result } = await run({ worker, ledger })
            expect(result.success).toBe(false)
            expect(ledger.charges).toHaveLength(0)
        })

        it('refuses the step BEFORE touching the browser when the balance is empty', async () => {
            const db = new FirestoreDouble({ 'users/user1': { gold: 0 } })
            const worker = createWorkerDouble({ navigate: () => pageResult() })
            const ledger = createLedgerDouble()
            const { result } = await run({ db, worker, ledger })

            expect(result.success).toBe(false)
            expect(result.reason).toBe('insufficient_gold')
            expect(worker.calls).toHaveLength(0)
            expect(ledger.charges).toHaveLength(0)
            expect(auditSteps(db)[0]).toMatchObject({ status: 'blocked', decisionReason: 'insufficient_gold' })
        })

        it('reports the cost back to the model', async () => {
            const worker = createWorkerDouble({ navigate: () => pageResult() })
            const { result } = await run({ worker })
            expect(result.goldCost).toBe(1)
        })
    })

    describe('screenshots', () => {
        it('stores the image and returns a link, never the bytes', async () => {
            const worker = createWorkerDouble({
                navigate: () => pageResult(),
                screenshot: () => ({
                    ok: true,
                    url: 'https://tickets.example/event/42',
                    screenshotBase64: Buffer.from('fake-png-bytes').toString('base64'),
                }),
            })
            const db = new FirestoreDouble()
            const bucket = createBucketDouble()
            await run({ db, worker, bucket })
            const { result } = await run({ db, worker, bucket, toolName: 'browser_screenshot', toolArgs: {} })

            expect(result.success).toBe(true)
            expect(result.evidence.screenshotUrl).toMatch(/firebasestorage\.googleapis\.com/)
            expect(JSON.stringify(result)).not.toContain('screenshotBase64')
            expect([...bucket.files.keys()].some(path => path.endsWith('-screenshot.png'))).toBe(true)
            expect(db.listCollection('browserRuns')[0].budget.screenshots).toBe(1)
        })

        it('still completes the step when the evidence upload fails', async () => {
            const worker = createWorkerDouble({
                navigate: () => pageResult(),
                screenshot: () => ({ ok: true, url: 'https://tickets.example/', screenshotBase64: 'AAAA' }),
            })
            const db = new FirestoreDouble()
            const failingBucket = {
                name: 'b',
                file: () => ({
                    save: async () => {
                        throw new Error('bucket unavailable')
                    },
                }),
            }
            await run({ db, worker, bucket: failingBucket })
            const { result } = await run({
                db,
                worker,
                bucket: failingBucket,
                toolName: 'browser_screenshot',
                toolArgs: {},
            })
            expect(result.success).toBe(true)
            expect(result.evidence.notStored).toContain('screenshot_upload_failed')
        })
    })
})
