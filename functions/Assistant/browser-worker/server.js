'use strict'

// The browser worker's HTTP surface. Three operations, and none of them decides anything:
//
//   POST /v1/describe   resolve an element and report what it is, without touching it
//   POST /v1/act        perform one already-approved action
//   POST /v1/close      drop the context
//
// Authorisation is the signed token minted by Cloud Functions (`browserWorkerClient.mintWorkerToken`),
// and the ALLOWLIST and LIMITS travel inside it. The worker therefore cannot be talked into a wider
// allowlist by its caller, and a leaked token is worth two minutes of browsing on the sites that
// token was already allowed to open.
//
// The service must be deployed with ingress restricted and `--no-allow-unauthenticated`; the token
// is the second lock, not the first.

const express = require('express')

const { requireShared } = require('./sharedModules')

const { verifyWorkerToken } = requireShared('browserWorkerClient')
const {
    describeElement,
    ensureNetworkGuard,
    performClick,
    performInspect,
    performNavigate,
    performScreenshot,
    performType,
    performWait,
} = require('./browserActions')
const { closeSession, getOrCreateSession, getSession, shutdown, takeUsageDelta } = require('./sessionStore')

const app = express()
app.use(express.json({ limit: '256kb' }))

const SIGNING_SECRET = process.env.BROWSER_WORKER_SIGNING_SECRET || ''

function authorize(request, response) {
    const header = request.get('authorization') || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    const verified = verifyWorkerToken(token, SIGNING_SECRET)
    if (!verified.valid) {
        response.status(401).json({ error: 'Unauthorized', reason: verified.reason })
        return null
    }
    // The session is named in the token, so one run's token can never drive another run's context.
    const bodySessionId = request.body && request.body.sessionId
    if (bodySessionId && verified.sessionId && bodySessionId !== verified.sessionId) {
        response.status(403).json({ error: 'Session mismatch', reason: 'session_mismatch' })
        return null
    }
    return verified
}

app.get('/healthz', (request, response) => {
    response.json({ ok: true, configured: !!SIGNING_SECRET })
})

app.post('/v1/describe', async (request, response) => {
    const auth = authorize(request, response)
    if (!auth) return
    const session = getSession(auth.sessionId)
    if (!session) {
        response.status(409).json({ error: 'There is no open page in this browsing session.', reason: 'no_session' })
        return
    }
    try {
        const result = await describeElement(session.page, request.body || {})
        response.status(result.ok ? 200 : 422).json(result)
    } catch (error) {
        response.status(500).json({ ok: false, error: error.message, reason: 'describe_failed' })
    }
})

app.post('/v1/act', async (request, response) => {
    const auth = authorize(request, response)
    if (!auth) return
    const payload = request.body || {}
    const action = payload.action

    try {
        if (action === 'navigate') {
            const session = await getOrCreateSession(auth.sessionId, {
                idleMs: Number(auth.limits?.idleMs) || undefined,
            })
            await ensureNetworkGuard(session, { allowlist: auth.allowlist, limits: auth.limits })
            const result = await performNavigate(session, payload)
            respond(response, result, session)
            return
        }

        const session = getSession(auth.sessionId)
        if (!session) {
            response
                .status(409)
                .json({ error: 'There is no open page in this browsing session.', reason: 'no_session' })
            return
        }
        await ensureNetworkGuard(session, { allowlist: auth.allowlist, limits: auth.limits })

        let result
        switch (action) {
            case 'inspect':
                result = await performInspect(session, payload)
                break
            case 'click':
                result = await performClick(session, payload)
                break
            case 'type':
                result = await performType(session, payload)
                break
            case 'wait':
                result = await performWait(session, payload)
                break
            case 'screenshot':
                result = await performScreenshot(session, payload)
                break
            default:
                response.status(400).json({ error: `Unsupported action: ${action}`, reason: 'unknown_action' })
                return
        }
        respond(response, result, session)
    } catch (error) {
        const session = getSession(auth.sessionId)
        const timedOut = /timeout/i.test(error.message || '')
        response.status(timedOut ? 504 : 500).json({
            ok: false,
            error: timedOut ? 'The page did not respond in time.' : error.message,
            reason: timedOut ? 'timeout' : 'action_failed',
            usage: session ? takeUsageDelta(session) : null,
        })
    }
})

app.post('/v1/close', async (request, response) => {
    const auth = authorize(request, response)
    if (!auth) return
    const closed = await closeSession(auth.sessionId, 'requested')
    response.json({ ok: true, closed })
})

function respond(response, result, session) {
    const usage = takeUsageDelta(session)
    response.status(result.ok ? 200 : 422).json({ ...result, usage })
}

const port = Number(process.env.PORT) || 8080
const server = app.listen(port, () => {
    console.log(`browser-worker listening on ${port}`, { configured: !!SIGNING_SECRET })
})

async function stop(signal) {
    console.log(`browser-worker: shutting down (${signal})`)
    server.close()
    await shutdown()
    process.exit(0)
}

process.on('SIGTERM', () => stop('SIGTERM'))
process.on('SIGINT', () => stop('SIGINT'))

module.exports = { app }
