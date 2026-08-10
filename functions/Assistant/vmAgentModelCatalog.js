/**
 * Live model-family discovery for the VM coding agents (AT-2221).
 *
 * The user picks a *family* ("Opus", "Sonnet", "Sol", "Terra", …), never a concrete version.
 * The family is resolved to an actual model id at execution time, so a saved preference keeps
 * following the newest release of that family without anyone editing this file.
 *
 * Why families and not ids: provider version numbers move constantly (claude-opus-4-8 →
 * claude-opus-5, gpt-5.6-sol → gpt-5.7-sol). A stored concrete id silently rots into a
 * yesterday's-model preference; a stored family does not. This mirrors how both providers
 * describe their own line-ups — Anthropic's tiers are Opus/Sonnet/Haiku/Fable, and OpenAI
 * states that for GPT-5.6 the *number* is the generation while Sol/Terra/Luna are durable
 * capability tiers that advance on their own cadence.
 *
 * Discovery uses the platform provider keys and is cached in Firestore for all users
 * (CATALOG_TTL_MS), because the answer is identical for everyone and a settings screen must
 * not pay a provider round-trip. Everything degrades: live → cached (even if stale) →
 * hardcoded fallback. Discovery failure must never block the Settings UI or a VM run.
 */

const admin = require('firebase-admin')

const CATALOG_COLLECTION = 'vmAgentModelCatalog'
const CATALOG_TTL_MS = 12 * 60 * 60 * 1000
const DISCOVERY_TIMEOUT_MS = 8000

const VALID_PROVIDERS = ['claude', 'codex']

/**
 * Claude Code accepts these as *moving aliases* on `--model` and resolves each to the newest
 * release of that family itself. Passing the alias is strictly better than passing a concrete
 * id we discovered: the CLI's answer is authoritative at the moment the run starts, and
 * vmJobRunner already captures the concrete id back out of the stream (`resolvedAgentModel`)
 * for display. Families NOT in this set (fable, mythos, anything new) have no alias, so we
 * resolve them to the newest discovered concrete id instead.
 */
const CLAUDE_CLI_ALIAS_FAMILIES = ['opus', 'sonnet', 'haiku']

// Display order for known families; anything discovered but unlisted is appended in
// version order, so a brand-new tier still shows up without a code change.
const CLAUDE_FAMILY_ORDER = ['opus', 'sonnet', 'haiku', 'fable', 'mythos']
const CODEX_FAMILY_ORDER = ['sol', 'terra', 'luna']

/**
 * Last-resort catalogs. Only used when discovery fails AND no cached catalog exists, so the
 * Settings screen still offers a sane choice. Deliberately conservative: the families here are
 * the ones the app already ships defaults for.
 */
const FALLBACK_CATALOGS = {
    claude: {
        families: [
            { id: 'opus', label: 'Opus', resolvedModel: 'opus', isAlias: true },
            { id: 'sonnet', label: 'Sonnet', resolvedModel: 'sonnet', isAlias: true },
            { id: 'haiku', label: 'Haiku', resolvedModel: 'haiku', isAlias: true },
        ],
    },
    codex: {
        families: [
            { id: 'sol', label: 'Sol', resolvedModel: 'gpt-5.6-sol', isAlias: false },
            { id: 'terra', label: 'Terra', resolvedModel: 'gpt-5.6-terra', isAlias: false },
            { id: 'luna', label: 'Luna', resolvedModel: 'gpt-5.6-luna', isAlias: false },
        ],
    },
}

// ---------------------------------------------------------------------------
// Model id parsing
// ---------------------------------------------------------------------------

// Current Anthropic scheme: claude-<family>-<major>[-<minor>][-<yyyymmdd>]
const CLAUDE_MODERN_PATTERN = /^claude-([a-z][a-z0-9]*)-(\d+)(?:-(\d+))?(?:-(\d{8}))?$/
// Legacy Anthropic scheme (family after the version): claude-3-opus-20240229, claude-3-5-sonnet-…
const CLAUDE_LEGACY_PATTERN = /^claude-(\d+)(?:-(\d+))?-([a-z][a-z0-9]*)(?:-(\d{8}))?$/
// OpenAI GPT scheme: gpt-<major>[.<minor>]-<family>
const CODEX_PATTERN = /^gpt-(\d+)(?:\.(\d+))?-([a-z][a-z0-9]*)$/

function toVersion(major, minor) {
    return { major: Number(major) || 0, minor: Number(minor) || 0 }
}

/**
 * Parse a provider model id into { family, major, minor }, or null when the id is not a
 * family-shaped chat model (embeddings, whisper, dall-e, `gpt-4o`, `claude-2.1`, …).
 */
function parseModelId(provider, modelId) {
    if (typeof modelId !== 'string' || !modelId) return null
    const id = modelId.trim().toLowerCase()

    if (provider === 'claude') {
        const modern = CLAUDE_MODERN_PATTERN.exec(id)
        if (modern) {
            const [, family, major, minor] = modern
            return { id, family, ...toVersion(major, minor) }
        }
        const legacy = CLAUDE_LEGACY_PATTERN.exec(id)
        if (legacy) {
            const [, major, minor, family] = legacy
            return { id, family, ...toVersion(major, minor) }
        }
        return null
    }

    if (provider === 'codex') {
        const match = CODEX_PATTERN.exec(id)
        if (!match) return null
        const [, major, minor, family] = match
        return { id, family, ...toVersion(major, minor) }
    }

    return null
}

function compareVersions(a, b) {
    if (a.major !== b.major) return a.major - b.major
    return a.minor - b.minor
}

function titleCase(value) {
    return value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * Group parsed models into families, each pointing at its newest member.
 *
 * Codex-only rule: keep families that exist in the newest generation. OpenAI's suffix is the
 * capability tier and the number is the generation, so a tier that stopped shipping (the
 * gpt-5.4-era `mini`/`nano`) is genuinely retired rather than merely older, while Sol/Terra/Luna
 * all appear at the current generation. Claude does NOT get this rule: Haiku 4.5 sits a whole
 * major behind Opus 5 and is still a current, offered tier.
 */
function buildFamilies(provider, modelIds) {
    const parsed = (modelIds || []).map(id => parseModelId(provider, id)).filter(Boolean)
    if (!parsed.length) return []

    const newestByFamily = new Map()
    for (const model of parsed) {
        const current = newestByFamily.get(model.family)
        if (!current || compareVersions(model, current) > 0) newestByFamily.set(model.family, model)
    }

    let entries = Array.from(newestByFamily.values())

    if (provider === 'codex') {
        // Generation is major.minor for OpenAI ("5.6"), so compare both — matching on the major
        // alone would keep the retired gpt-5.4 `mini`/`nano` tiers alive next to gpt-5.6.
        const newestGeneration = entries.reduce(
            (best, entry) => (compareVersions(entry, best) > 0 ? entry : best),
            entries[0]
        )
        entries = entries.filter(entry => compareVersions(entry, newestGeneration) === 0)
    }

    const order = provider === 'claude' ? CLAUDE_FAMILY_ORDER : CODEX_FAMILY_ORDER
    entries.sort((a, b) => {
        const rankA = order.indexOf(a.family)
        const rankB = order.indexOf(b.family)
        if (rankA !== rankB) return (rankA === -1 ? order.length : rankA) - (rankB === -1 ? order.length : rankB)
        return compareVersions(b, a)
    })

    return entries.map(entry => {
        const isAlias = provider === 'claude' && CLAUDE_CLI_ALIAS_FAMILIES.includes(entry.family)
        return {
            id: entry.family,
            label: titleCase(entry.family),
            // What actually goes on the command line. An alias lets the CLI pick the newest
            // release itself; otherwise we pin the newest id we discovered.
            resolvedModel: isAlias ? entry.family : entry.id,
            latestModel: entry.id,
            isAlias,
        }
    })
}

// ---------------------------------------------------------------------------
// Provider discovery
// ---------------------------------------------------------------------------

const PROVIDER_DISCOVERY = {
    claude: {
        keyField: 'ANTHROPIC_API_KEY',
        url: 'https://api.anthropic.com/v1/models?limit=1000',
        headers: apiKey => ({ 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }),
    },
    codex: {
        keyField: 'OPEN_AI_KEY',
        url: 'https://api.openai.com/v1/models',
        headers: apiKey => ({ Authorization: `Bearer ${apiKey}` }),
    },
}

function extractModelIds(payload) {
    const list = payload && Array.isArray(payload.data) ? payload.data : []
    return list.map(entry => (entry && typeof entry.id === 'string' ? entry.id : null)).filter(Boolean)
}

/**
 * Hit the provider's models endpoint with the platform key. Returns the raw id list.
 * Throws on any failure — callers fall back to cache/static.
 */
async function fetchProviderModelIds(provider, options = {}) {
    const config = PROVIDER_DISCOVERY[provider]
    if (!config) throw new Error(`Unknown provider "${provider}".`)

    const env = options.env || require('../envFunctionsHelper').getEnvFunctions()
    const apiKey = env && env[config.keyField]
    if (!apiKey) throw new Error(`Missing ${config.keyField} for VM model discovery.`)

    const fetchImpl = options.fetchImpl || global.fetch
    if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable in this runtime.')

    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS) : null
    try {
        const response = await fetchImpl(config.url, {
            method: 'GET',
            headers: config.headers(apiKey),
            ...(controller ? { signal: controller.signal } : {}),
        })
        if (!response || !response.ok) {
            throw new Error(`Model discovery failed with status ${response ? response.status : 'unknown'}.`)
        }
        return extractModelIds(await response.json())
    } finally {
        if (timer) clearTimeout(timer)
    }
}

// ---------------------------------------------------------------------------
// Cached catalog
// ---------------------------------------------------------------------------

function catalogRef(provider) {
    return admin.firestore().doc(`${CATALOG_COLLECTION}/${provider}`)
}

async function readCachedCatalog(provider) {
    try {
        const snapshot = await catalogRef(provider).get()
        if (!snapshot.exists) return null
        const data = snapshot.data() || {}
        if (!Array.isArray(data.families) || !data.families.length) return null
        return { families: data.families, fetchedAt: data.fetchedAt || 0, source: 'cache' }
    } catch (error) {
        console.warn('🖥️ VM MODELS: Failed reading cached model catalog', { provider, error: error.message })
        return null
    }
}

async function writeCachedCatalog(provider, families, fetchedAt) {
    try {
        await catalogRef(provider).set({ families, fetchedAt, provider }, { merge: true })
    } catch (error) {
        console.warn('🖥️ VM MODELS: Failed writing model catalog cache', { provider, error: error.message })
    }
}

function isFresh(catalog, now) {
    return !!catalog && typeof catalog.fetchedAt === 'number' && now - catalog.fetchedAt < CATALOG_TTL_MS
}

/**
 * The catalog for one provider, preferring live discovery but never failing.
 *
 * Order: fresh cache → live discovery (then cached) → stale cache → static fallback.
 * `source` tells the UI which one it got so it can say "showing saved options" honestly.
 */
async function getModelCatalog(provider, options = {}) {
    if (!VALID_PROVIDERS.includes(provider)) throw new Error(`Unknown provider "${provider}".`)

    const now = typeof options.now === 'number' ? options.now : Date.now()
    const cached = options.forceRefresh ? null : await readCachedCatalog(provider)
    if (isFresh(cached, now)) return { ...cached, source: 'cache' }

    try {
        const modelIds = await fetchProviderModelIds(provider, options)
        const families = buildFamilies(provider, modelIds)
        if (families.length) {
            await writeCachedCatalog(provider, families, now)
            return { families, fetchedAt: now, source: 'live' }
        }
        console.warn('🖥️ VM MODELS: Discovery returned no usable families', { provider, count: modelIds.length })
    } catch (error) {
        console.warn('🖥️ VM MODELS: Live model discovery failed', { provider, error: error.message })
    }

    // Stale beats static: a 3-day-old real catalog is closer to the truth than our hardcoded one.
    if (cached) return { ...cached, source: 'stale' }
    return { families: FALLBACK_CATALOGS[provider].families, fetchedAt: 0, source: 'fallback' }
}

async function getAllModelCatalogs(options = {}) {
    const [claude, codex] = await Promise.all([getModelCatalog('claude', options), getModelCatalog('codex', options)])
    return { claude, codex }
}

function isValidFamilyId(familyId) {
    return typeof familyId === 'string' && /^[a-z][a-z0-9]{0,31}$/.test(familyId)
}

/**
 * Turn a saved family preference into the model id the CLI should run.
 * Returns null when the family is unknown, so callers keep their existing default.
 */
async function resolveFamilyToModel(provider, familyId, options = {}) {
    if (!isValidFamilyId(familyId)) return null
    const catalog = await getModelCatalog(provider, options)
    const match = catalog.families.find(family => family.id === familyId)
    if (match) return match.resolvedModel

    // Discovery may be degraded; an alias family is still safe to pass through to Claude Code,
    // which resolves it itself. Better than silently dropping the user's choice.
    if (provider === 'claude' && CLAUDE_CLI_ALIAS_FAMILIES.includes(familyId)) return familyId
    return null
}

module.exports = {
    CATALOG_TTL_MS,
    CATALOG_COLLECTION,
    VALID_PROVIDERS,
    CLAUDE_CLI_ALIAS_FAMILIES,
    FALLBACK_CATALOGS,
    parseModelId,
    buildFamilies,
    fetchProviderModelIds,
    getModelCatalog,
    getAllModelCatalogs,
    resolveFamilyToModel,
    isValidFamilyId,
}
