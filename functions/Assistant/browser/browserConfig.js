'use strict'

// Resolves whether browsing is available at all, and under which allowlist and limits.
//
// Fails closed on every path. Browsing is only enabled when ALL of these hold: a worker URL, a
// signing secret, and a non-empty allowlist. Missing any of them is not an error the model retries
// around — it is reported once, with the names of what is missing, so an operator can fix it and a
// user is not told "the site could not be read" for a configuration problem.
//
// The allowlist is the UNION of an environment-wide list and the project's own. Two notes on that:
// the project list is member-writable Firestore data, so it is validated exactly like the env one
// (`normalizeAllowlist` rejects IP literals, private hosts, bare `*` and single-label hosts), and
// widening it only ever widens what may be READ — every state-changing action on any host, however
// it got onto the list, still needs an explicit approval. That keeps the trust question to
// "which public sites may this project open", which is the decision a project owner should own.
//
// The ACCESS MODE is the project's, defaulting to the environment's and finally to `selected`. In
// `all_public` an empty allowlist is no longer a configuration error — the list simply stops being
// the gate — but nothing else relaxes: the safety checks in `browserAllowlist` are unconditional,
// and the DENYLIST (union of env and project, because union is the safe direction for a deny rule)
// still wins over both modes.

const {
    ACCESS_MODE_ALL_PUBLIC,
    buildBrowsingPolicy,
    normalizeAccessMode,
    normalizeAllowlist,
} = require('./browserAllowlist')
const { resolveBrowserLimits } = require('./browserLimits')

const PROJECT_CONFIG_FIELD = 'browserAutomation'

function readEnvValue(env, key) {
    if (!env || typeof env !== 'object') return ''
    const value = env[key]
    if (typeof value !== 'string') return ''
    const trimmed = value.trim()
    // The env helper substitutes obvious placeholders; treat them as absent rather than as a URL.
    if (!trimmed || /^your_/i.test(trimmed) || /^replace_/i.test(trimmed)) return ''
    return trimmed
}

function normalizeWorkerBaseUrl(rawUrl) {
    const value = typeof rawUrl === 'string' ? rawUrl.trim() : ''
    if (!value) return ''
    let parsed
    try {
        parsed = new URL(value)
    } catch (error) {
        return ''
    }
    // The worker is reached over the public Cloud Run URL with a signed token; plain http would put
    // that token on the wire in clear.
    if (parsed.protocol !== 'https:') return ''
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
}

/**
 * @param {object} env         the object returned by `getEnvFunctions()`
 * @param {object} projectConfig  `projects/{projectId}.browserAutomation`, or null
 */
function resolveBrowserConfig({ env = {}, projectConfig = null } = {}) {
    const workerBaseUrl = normalizeWorkerBaseUrl(readEnvValue(env, 'BROWSER_WORKER_URL'))
    const signingSecret = readEnvValue(env, 'BROWSER_WORKER_SIGNING_SECRET')

    const envAllowlist = normalizeAllowlist(readEnvValue(env, 'BROWSER_ALLOWED_DOMAINS'))
    const project = projectConfig && typeof projectConfig === 'object' ? projectConfig : {}
    const projectAllowlist = normalizeAllowlist(project.allowedDomains)

    const combined = normalizeAllowlist([
        ...envAllowlist.entries.map(entry => serializeAllowlistEntry(entry)),
        ...projectAllowlist.entries.map(entry => serializeAllowlistEntry(entry)),
    ])

    const envDenylist = normalizeAllowlist(readEnvValue(env, 'BROWSER_DENIED_DOMAINS'))
    const projectDenylist = normalizeAllowlist(project.deniedDomains)
    const combinedDenylist = normalizeAllowlist([
        ...envDenylist.entries.map(entry => serializeAllowlistEntry(entry)),
        ...projectDenylist.entries.map(entry => serializeAllowlistEntry(entry)),
    ])

    // The project chooses; the environment only supplies the default for a project that has not.
    const accessMode = normalizeAccessMode(project.accessMode || readEnvValue(env, 'BROWSER_ACCESS_MODE') || undefined)
    const allPublic = accessMode === ACCESS_MODE_ALL_PUBLIC

    const limits = resolveBrowserLimits(project.limits)
    const rejectedAllowlistEntries = [...envAllowlist.rejected, ...projectAllowlist.rejected]
    const rejectedDenylistEntries = [...envDenylist.rejected, ...projectDenylist.rejected]

    const missing = []
    if (!workerBaseUrl) missing.push('BROWSER_WORKER_URL')
    if (!signingSecret) missing.push('BROWSER_WORKER_SIGNING_SECRET')
    // In `all_public` the allowlist is not the gate, so an empty one is a choice rather than an
    // unfinished configuration.
    if (!allPublic && combined.entries.length === 0) missing.push('allowlist')

    const disabledByProject = project.enabled === false
    const enabled = missing.length === 0 && !disabledByProject

    return {
        enabled,
        disabledByProject,
        missing,
        workerBaseUrl,
        signingSecret,
        accessMode,
        allPublic,
        allowlist: combined.entries,
        denylist: combinedDenylist.entries,
        // One object, built once, carried by the worker token and read by both the policy and the
        // worker's network guard, so "which hosts" cannot be answered twice.
        policy: buildBrowsingPolicy({
            mode: accessMode,
            allowlist: combined.entries,
            denylist: combinedDenylist.entries,
        }),
        rejectedAllowlistEntries,
        rejectedDenylistEntries,
        limits,
        // A GET search form is a read; a project may still require an approval for it.
        allowSearchSubmit: project.allowSearchSubmit !== false,
    }
}

function serializeAllowlistEntry(entry) {
    if (!entry || typeof entry !== 'object') return ''
    return `${entry.subdomainsOnly ? '*.' : ''}${entry.host}${entry.pathPrefix || ''}`
}

function describeMissingConfiguration(config) {
    if (!config || config.enabled) return ''
    if (config.disabledByProject) return 'Browsing is switched off for this project.'
    if (config.missing.includes('allowlist')) {
        // Names both ways out, because "add sites" and "switch the mode" are genuinely different
        // decisions and an operator who only hears the first one may not know the second exists.
        return 'Browsing is not available: this project allows only selected websites and none have been added yet. Add the sites the assistant may open in the assistant\'s Tools Access settings, or switch that project to "All public websites".'
    }
    return `Browsing is not available: the browser worker is not configured (${config.missing.join(', ')}).`
}

/**
 * Read the per-project overrides. A read failure yields `null` (i.e. env-only configuration) rather
 * than throwing: losing a project's extra allowlist entries makes browsing narrower, which is the
 * safe direction, while throwing would take the whole tool down for a transient Firestore blip.
 */
async function loadProjectBrowserConfig(db, projectId) {
    if (!db || !projectId) return null
    try {
        const snapshot = await db.doc(`projects/${projectId}`).get()
        if (!snapshot || !snapshot.exists) return null
        const data = typeof snapshot.data === 'function' ? snapshot.data() : null
        const config = data ? data[PROJECT_CONFIG_FIELD] : null
        return config && typeof config === 'object' ? config : null
    } catch (error) {
        console.warn('🌐 BROWSER: could not read the project browsing configuration', {
            projectId,
            error: error.message,
        })
        return null
    }
}

module.exports = {
    PROJECT_CONFIG_FIELD,
    describeMissingConfiguration,
    loadProjectBrowserConfig,
    normalizeWorkerBaseUrl,
    resolveBrowserConfig,
    serializeAllowlistEntry,
}
