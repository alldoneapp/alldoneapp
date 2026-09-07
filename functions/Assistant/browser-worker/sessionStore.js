'use strict'

// One short-lived, credential-free browser context per browsing run, and the sweeper that throws it
// away.
//
// The isolation properties this file is responsible for:
//
// - A context is created per session and NEVER persisted. There is no `storageState` on the way in
//   and none is written on the way out, so cookies, localStorage and any session a page hands out
//   die with the context. Two runs — even two runs of the same user on the same site — never share
//   a logged-in state, which is what makes "the assistant is browsing on your behalf" false in the
//   only sense that matters: it is browsing as nobody.
// - Downloads are refused, dialogs are dismissed, popups are closed. Each of them is a way for a
//   page to move the run somewhere the policy never looked at.
// - Every session has an idle deadline and the process has a session cap, so a wedged page costs
//   one context for a bounded time rather than a container.

const { chromium } = require('playwright')

const MAX_SESSIONS = Number(process.env.BROWSER_WORKER_MAX_SESSIONS || 8)
const DEFAULT_IDLE_MS = Number(process.env.BROWSER_WORKER_IDLE_MS || 3 * 60 * 1000)
const SWEEP_INTERVAL_MS = 30 * 1000
const USER_AGENT_SUFFIX = 'AlldoneBrowser/1.0 (+https://alldone.app)'

const sessions = new Map()
let browserPromise = null
let sweeper = null

async function getBrowser() {
    if (!browserPromise) {
        browserPromise = chromium.launch({
            headless: true,
            args: [
                '--disable-dev-shm-usage',
                // The context is the isolation boundary we rely on; the sandbox stays ON.
                '--disable-background-networking',
                '--disable-features=Translate,BackForwardCache',
            ],
        })
        browserPromise.catch(() => {
            browserPromise = null
        })
    }
    return browserPromise
}

function startSweeper() {
    if (sweeper) return
    sweeper = setInterval(() => {
        const now = Date.now()
        for (const [sessionId, session] of sessions.entries()) {
            if (now - session.lastUsedAt > session.idleMs) {
                closeSession(sessionId, 'idle').catch(() => {})
            }
        }
    }, SWEEP_INTERVAL_MS)
    if (typeof sweeper.unref === 'function') sweeper.unref()
}

async function createSession(
    sessionId,
    { idleMs = DEFAULT_IDLE_MS, locale = 'de-DE', timezoneId = 'Europe/Berlin' } = {}
) {
    if (sessions.size >= MAX_SESSIONS) {
        // Evicting the least recently used one is better than refusing: a stuck session from a run
        // that has already returned an answer must not block the next user.
        const oldest = [...sessions.entries()].sort((first, second) => first[1].lastUsedAt - second[1].lastUsedAt)[0]
        if (oldest) await closeSession(oldest[0], 'evicted')
    }

    const browser = await getBrowser()
    const context = await browser.newContext({
        acceptDownloads: false,
        serviceWorkers: 'block',
        javaScriptEnabled: true,
        locale,
        timezoneId,
        viewport: { width: 1280, height: 900 },
        userAgent: undefined,
        extraHTTPHeaders: { 'X-Alldone-Automation': USER_AGENT_SUFFIX },
        permissions: [],
        // No storageState in, none out. See the header.
    })
    context.setDefaultTimeout(20000)
    context.setDefaultNavigationTimeout(30000)

    const page = await context.newPage()
    page.on('dialog', dialog => {
        dialog.dismiss().catch(() => {})
    })
    context.on('page', extraPage => {
        if (extraPage !== page) extraPage.close().catch(() => {})
    })

    const session = {
        sessionId,
        context,
        page,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        idleMs,
        usage: { networkRequests: 0, responseBytes: 0, blockedRequests: 0 },
        refCounter: 0,
        lastNavigationRedirects: [],
    }
    sessions.set(sessionId, session)
    startSweeper()
    return session
}

function getSession(sessionId) {
    const session = sessions.get(sessionId)
    if (session) session.lastUsedAt = Date.now()
    return session || null
}

async function getOrCreateSession(sessionId, options) {
    return getSession(sessionId) || createSession(sessionId, options)
}

async function closeSession(sessionId, reason = 'closed') {
    const session = sessions.get(sessionId)
    if (!session) return false
    sessions.delete(sessionId)
    try {
        await session.context.close()
    } catch (error) {
        console.warn('browser-worker: closing the context failed', { sessionId, reason, error: error.message })
    }
    return true
}

/** Usage since the last call, so the caller charges each step once. */
function takeUsageDelta(session) {
    const usage = { ...session.usage }
    const previous = session.reportedUsage || { networkRequests: 0, responseBytes: 0, blockedRequests: 0 }
    session.reportedUsage = usage
    return {
        networkRequests: Math.max(0, usage.networkRequests - previous.networkRequests),
        responseBytes: Math.max(0, usage.responseBytes - previous.responseBytes),
        blockedRequests: Math.max(0, usage.blockedRequests - previous.blockedRequests),
    }
}

async function shutdown() {
    for (const sessionId of [...sessions.keys()]) await closeSession(sessionId, 'shutdown')
    if (sweeper) clearInterval(sweeper)
    sweeper = null
    const browser = browserPromise ? await browserPromise.catch(() => null) : null
    if (browser) await browser.close().catch(() => {})
    browserPromise = null
}

module.exports = {
    DEFAULT_IDLE_MS,
    MAX_SESSIONS,
    closeSession,
    createSession,
    getOrCreateSession,
    getSession,
    sessions,
    shutdown,
    takeUsageDelta,
}
