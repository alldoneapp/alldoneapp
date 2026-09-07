'use strict'

// The resource budget of one browsing run, and the only place that decides whether a step still
// fits in it.
//
// Two properties are load-bearing. The budget is a plain serializable counter object, because it
// lives on the session document and is charged inside the same Firestore transaction that hands out
// the step — a budget held in worker memory would reset with the container and a budget held in the
// Functions instance would reset with the invocation, and both would make "at most ten navigations"
// mean "at most ten per instance". And charging is a pure function returning a NEW budget rather
// than mutating one, so a transaction that retries cannot double-charge.
//
// The split with the worker is deliberate: what a run may do ACROSS tool calls (steps, navigations,
// screenshots, wall clock) is counted here, and what one page may do WITHIN a step (requests, bytes,
// redirect hops) is enforced in the worker where the events actually happen — and reported back so
// the totals are still charged here.

// Hard ceilings. Configuration may lower any of these; it may never raise one, so a project-level
// setting cannot turn a bounded worker into an unbounded crawler.
const MAX_BROWSER_LIMITS = {
    maxSteps: 60,
    maxNavigations: 20,
    maxScreenshots: 20,
    maxRedirectsPerNavigation: 10,
    maxNetworkRequests: 600,
    maxResponseBytes: 40 * 1024 * 1024,
    maxRunWallClockMs: 10 * 60 * 1000,
    maxStepTimeoutMs: 45 * 1000,
    maxSessionIdleMs: 10 * 60 * 1000,
    maxSnapshotChars: 40000,
}

const DEFAULT_BROWSER_LIMITS = {
    maxSteps: 30,
    maxNavigations: 10,
    maxScreenshots: 8,
    maxRedirectsPerNavigation: 5,
    maxNetworkRequests: 250,
    maxResponseBytes: 20 * 1024 * 1024,
    maxRunWallClockMs: 5 * 60 * 1000,
    maxStepTimeoutMs: 20 * 1000,
    maxSessionIdleMs: 3 * 60 * 1000,
    maxSnapshotChars: 16000,
}

const BUDGET_COUNTERS = ['steps', 'navigations', 'screenshots', 'networkRequests', 'responseBytes']

const COUNTER_LIMIT_KEY = {
    steps: 'maxSteps',
    navigations: 'maxNavigations',
    screenshots: 'maxScreenshots',
    networkRequests: 'maxNetworkRequests',
    responseBytes: 'maxResponseBytes',
}

function clampNumber(value, fallback, maximum) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback
    return Math.min(Math.floor(parsed), maximum)
}

/**
 * Merge configured overrides onto the defaults, clamped to the hard ceilings above.
 * An unusable override (missing, zero, negative, NaN) falls back to the default rather than to the
 * ceiling — the failure direction of a typo has to be "less browsing", never "more".
 */
function resolveBrowserLimits(overrides = {}) {
    const source = overrides && typeof overrides === 'object' ? overrides : {}
    const limits = {}
    for (const key of Object.keys(DEFAULT_BROWSER_LIMITS)) {
        limits[key] = clampNumber(source[key], DEFAULT_BROWSER_LIMITS[key], MAX_BROWSER_LIMITS[key])
    }
    return limits
}

// `Number(value) || fallback` is wrong here: an epoch of 0 is falsy, so a budget started at 0 would
// silently restart its wall clock at "now" on every read — i.e. never expire.
function firstFiniteNumber(...values) {
    for (const value of values) {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) return parsed
    }
    return Date.now()
}

function createRunBudget(startedAt = Date.now()) {
    const budget = { startedAt: firstFiniteNumber(startedAt) }
    for (const counter of BUDGET_COUNTERS) budget[counter] = 0
    return budget
}

function normalizeBudget(budget, startedAt = Date.now()) {
    const source = budget && typeof budget === 'object' ? budget : {}
    const normalized = { startedAt: firstFiniteNumber(source.startedAt, startedAt) }
    for (const counter of BUDGET_COUNTERS) {
        const value = Number(source[counter])
        normalized[counter] = Number.isFinite(value) && value > 0 ? value : 0
    }
    return normalized
}

function describeLimit(counter, limitValue) {
    if (counter === 'responseBytes') return `${Math.round(limitValue / (1024 * 1024))} MB of downloaded data`
    if (counter === 'networkRequests') return `${limitValue} network requests`
    if (counter === 'navigations') return `${limitValue} page loads`
    if (counter === 'screenshots') return `${limitValue} screenshots`
    return `${limitValue} browsing steps`
}

/**
 * Charge a step against the run budget.
 *
 * Wall clock is checked first and separately: it is the limit that keeps a wedged page from holding
 * a worker session open, and unlike the counters it can be exceeded without anybody asking for
 * anything.
 *
 * Returns `{ ok, budget, violation }`; `budget` is a new object and is only advanced when `ok`.
 */
function chargeBrowserBudget(budget, limits, charges = {}, now = Date.now()) {
    const effectiveLimits = resolveBrowserLimits(limits)
    const current = normalizeBudget(budget, now)

    const elapsedMs = Math.max(0, now - current.startedAt)
    if (elapsedMs > effectiveLimits.maxRunWallClockMs) {
        return {
            ok: false,
            budget: current,
            violation: {
                counter: 'wallClock',
                limit: effectiveLimits.maxRunWallClockMs,
                used: elapsedMs,
                message: `This browsing run exceeded its ${Math.round(
                    effectiveLimits.maxRunWallClockMs / 1000
                )}s time budget. Start a new run if more browsing is needed.`,
            },
        }
    }

    const next = { ...current }
    for (const counter of BUDGET_COUNTERS) {
        const amount = Number(charges[counter])
        if (!Number.isFinite(amount) || amount <= 0) continue
        const limitKey = COUNTER_LIMIT_KEY[counter]
        const limitValue = effectiveLimits[limitKey]
        const used = current[counter] + amount
        if (used > limitValue) {
            return {
                ok: false,
                budget: current,
                violation: {
                    counter,
                    limit: limitValue,
                    used,
                    message: `This browsing run reached its limit of ${describeLimit(counter, limitValue)}.`,
                },
            }
        }
        next[counter] = used
    }

    return { ok: true, budget: next, violation: null, elapsedMs, limits: effectiveLimits }
}

/**
 * Charge what the worker reports it actually consumed inside a step (requests, bytes). This is
 * applied AFTER the step, so it can push a counter past its limit: the overshoot is recorded and the
 * next charge fails, which is the right order — the bytes are already downloaded, and refusing to
 * record them would leave the run able to repeat the same step forever.
 */
function applyWorkerUsage(budget, usage = {}, now = Date.now()) {
    const current = normalizeBudget(budget, now)
    const next = { ...current }
    const requests = Number(usage.networkRequests)
    const bytes = Number(usage.responseBytes)
    if (Number.isFinite(requests) && requests > 0) next.networkRequests = current.networkRequests + requests
    if (Number.isFinite(bytes) && bytes > 0) next.responseBytes = current.responseBytes + bytes
    return next
}

function summarizeBudget(budget, limits) {
    const effectiveLimits = resolveBrowserLimits(limits)
    const current = normalizeBudget(budget)
    return {
        steps: `${current.steps}/${effectiveLimits.maxSteps}`,
        navigations: `${current.navigations}/${effectiveLimits.maxNavigations}`,
        screenshots: `${current.screenshots}/${effectiveLimits.maxScreenshots}`,
        networkRequests: `${current.networkRequests}/${effectiveLimits.maxNetworkRequests}`,
        downloadedBytes: current.responseBytes,
        elapsedMs: Math.max(0, Date.now() - current.startedAt),
        runWallClockMs: effectiveLimits.maxRunWallClockMs,
    }
}

module.exports = {
    BUDGET_COUNTERS,
    DEFAULT_BROWSER_LIMITS,
    MAX_BROWSER_LIMITS,
    applyWorkerUsage,
    chargeBrowserBudget,
    createRunBudget,
    normalizeBudget,
    resolveBrowserLimits,
    summarizeBudget,
}
