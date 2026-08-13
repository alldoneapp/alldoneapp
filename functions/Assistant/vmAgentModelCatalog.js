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

const {
    isValidOpenRouterModelId,
    toOpenRouterSelection,
    isOpenRouterSelection,
    parseOpenRouterSelection,
    formatOpenRouterModelLabel,
} = require('./vmModelRouting')

const CATALOG_COLLECTION = 'vmAgentModelCatalog'
const CATALOG_TTL_MS = 12 * 60 * 60 * 1000
const DISCOVERY_TIMEOUT_MS = 8000

const VALID_PROVIDERS = ['claude', 'codex']

/**
 * OpenRouter is a model *source* for the Codex harness rather than a third agent (AT-2230): Codex
 * speaks an OpenAI-compatible wire protocol, so any tool-calling OpenRouter model can drive it.
 * It gets its own catalog document because its discovery endpoint, filtering rule and entry shape
 * are all different — but it rides the exact same cache/degrade machinery as the two agents.
 */
const OPENROUTER_PROVIDER = 'openrouter'
const CATALOG_PROVIDERS = [...VALID_PROVIDERS, OPENROUTER_PROVIDER]

/**
 * Codex requires tool calling; a model without it cannot run an agentic loop at all. That single
 * capability flag is the whole compatibility test, and OpenRouter publishes it per model, so the
 * list stays correct as vendors ship new releases without anyone editing this file.
 */
const OPENROUTER_REQUIRED_PARAMETER = 'tools'

// Vendors surfaced in the featured picker. Search still covers every compatible model from every
// vendor, so a brand-new vendor needs no code change. DeepSeek leads because it is the headline use
// case; the rest keep the compact default list broad instead of letting one prolific vendor consume
// every visible slot.
const OPENROUTER_VENDOR_ORDER = ['deepseek', 'qwen', 'moonshotai', 'z-ai', 'minimax', 'mistralai', 'x-ai', 'google']

// At most two featured models per major vendor: its newest generally available model, plus the
// strongest agentic model OpenRouter currently scores when that is a different release. The full
// compatible catalog is carried separately as a compact, client-safe search index.
const OPENROUTER_FEATURED_MODELS_PER_VENDOR = 2

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
    // Only the two long-lived DeepSeek pointer ids, which OpenRouter keeps aimed at the current
    // release of each line. A discovery outage should still leave the headline use case selectable.
    [OPENROUTER_PROVIDER]: {
        families: [
            {
                id: 'openrouter:deepseek/deepseek-chat',
                label: 'DeepSeek Chat',
                vendor: 'deepseek',
                modelId: 'deepseek/deepseek-chat',
                resolvedModel: 'openrouter:deepseek/deepseek-chat',
                isAlias: false,
            },
            {
                id: 'openrouter:deepseek/deepseek-r1',
                label: 'DeepSeek R1',
                vendor: 'deepseek',
                modelId: 'deepseek/deepseek-r1',
                resolvedModel: 'openrouter:deepseek/deepseek-r1',
                isAlias: false,
            },
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
// OpenRouter models (a source for the Codex harness, not an agent)
// ---------------------------------------------------------------------------

/**
 * True when an OpenRouter catalog entry can actually drive Codex.
 *
 * Two independent reasons a model is unusable, and both are silent failures at run time rather than
 * loud ones, which is why they are filtered here instead:
 *  - no tool calling → the agent loop cannot call a single tool and the run produces prose;
 *  - no text output → not a chat model at all (image/embedding endpoints appear in the same list).
 *
 * `openai/*` is excluded deliberately: those models are already offered natively on the OpenAI
 * source, and listing them twice invites a user to pay OpenRouter's margin for nothing.
 */
function isCodexCompatibleOpenRouterModel(entry) {
    if (!entry || typeof entry.id !== 'string') return false
    if (!isValidOpenRouterModelId(entry.id)) return false
    if (entry.id.toLowerCase().startsWith('openai/')) return false

    const supported = Array.isArray(entry.supported_parameters) ? entry.supported_parameters : []
    if (!supported.includes(OPENROUTER_REQUIRED_PARAMETER)) return false

    const outputs =
        entry.architecture && Array.isArray(entry.architecture.output_modalities)
            ? entry.architecture.output_modalities
            : null
    if (outputs && !outputs.includes('text')) return false

    return true
}

function openRouterVendor(modelId) {
    return String(modelId).split('/')[0].toLowerCase()
}

/**
 * OpenRouter's per-token prices for one model, normalized to USD per 1M tokens — the shape
 * `vmTokenPricing.blendedUsdPerMillionTokens` consumes.
 *
 * This is what makes Gold pricing per-model and self-updating rather than a hardcoded table: a
 * vendor's price cut, or a model released after this code shipped, is priced from its real numbers
 * within the catalog TTL.
 *
 * `cachedInput` stays **null** when the model publishes no `input_cache_read` price, and that
 * distinction is load-bearing rather than tidiness: ~85% of a VM run's metered tokens are cache
 * reads, so a model with no prompt caching is genuinely far dearer to run than its list price
 * suggests, and `null` is what tells the pricing module to bill those tokens at full input price.
 */
function normalizeOpenRouterPricing(pricing) {
    if (!pricing || typeof pricing !== 'object') return null

    const perMillion = value => {
        if (value == null || value === '') return null
        const parsed = Number(value)
        return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1e6 : null
    }

    const input = perMillion(pricing.prompt)
    const output = perMillion(pricing.completion)
    // A free model reports "0", which is a real price; only a missing/unparseable one is unusable.
    if (input === null || output === null) return null

    return { input, output, cachedInput: perMillion(pricing.input_cache_read) }
}

/**
 * Upstream prices for **every** Codex-compatible model rather than only the featured picker. Search
 * and an `agentModel` tool argument can name any valid id, and a job priced off a missing entry would
 * silently fall back to the Sol base rate. A few hundred small entries cost nothing against
 * Firestore's 1MB document limit.
 *
 * An array of `{ id, … }` rather than an id-keyed map on purpose: OpenRouter ids contain `/`, `.` and
 * sometimes `:`, and while Firestore tolerates those in map keys written via `set()`, `.` is a field
 * *path* separator everywhere else in the API — so any later `update()` or field-mask touch of this
 * doc would silently address the wrong nesting. An array has no key syntax to collide with.
 */
function buildOpenRouterPricing(entries) {
    const pricing = []
    for (const entry of Array.isArray(entries) ? entries : []) {
        if (!isCodexCompatibleOpenRouterModel(entry)) continue
        const normalized = normalizeOpenRouterPricing(entry.pricing)
        if (normalized) pricing.push({ id: entry.id.toLowerCase(), ...normalized })
    }
    return pricing
}

/**
 * The upstream price for one OpenRouter model, read from the cached catalog.
 *
 * Returns `null` on a miss or any failure, which the pricing module handles by falling through to its
 * researched static table and then to the Sol base rate — so a discovery outage degrades the *price
 * source*, never the run.
 */
async function getOpenRouterUpstreamPrice(modelId, options = {}) {
    if (typeof modelId !== 'string' || !modelId.trim()) return null
    try {
        const catalog = await getModelCatalog(OPENROUTER_PROVIDER, { ...options, includePricing: true })
        const key = modelId.trim().toLowerCase()

        const priced = (Array.isArray(catalog?.pricing) ? catalog.pricing : []).find(entry => entry.id === key)
        if (priced) return { input: priced.input, output: priced.output, cachedInput: priced.cachedInput }

        // Fall back to the picker entries, which carry their own price: a stale cached catalog
        // written before the `pricing` list existed still prices its listed models correctly.
        const match = (catalog?.families || []).find(entry => String(entry.modelId).toLowerCase() === key)
        return match && match.upstreamPrice ? match.upstreamPrice : null
    } catch (error) {
        console.warn('🖥️ VM MODELS: Failed resolving OpenRouter upstream price', { modelId, error: error.message })
        return null
    }
}

/**
 * Shape the discovered OpenRouter list into picker entries.
 *
 * Entries intentionally mirror the `families` shape the Claude/Codex catalogs already return
 * (`id` / `label` / `resolvedModel`) so the settings payload, the persistence layer and the UI need
 * exactly one code path. The difference is what `id` means: a family for an agent, a concrete
 * prefixed model selection here — OpenRouter ids like `deepseek/deepseek-chat` are already moving
 * pointers maintained by the vendor, so there is no family layer left to invent.
 */
function openRouterAgenticScore(entry) {
    const rawScore = entry?.benchmarks?.artificial_analysis?.agentic_index
    if (rawScore == null || rawScore === '') return null
    const score = Number(rawScore)
    return Number.isFinite(score) ? score : null
}

function toOpenRouterModel(entry, vendor = openRouterVendor(entry.id), includePricing = true) {
    return {
        id: toOpenRouterSelection(entry.id),
        // Prefer OpenRouter's own display name; derive one only when it is missing.
        label:
            typeof entry.name === 'string' && entry.name.trim()
                ? entry.name.trim()
                : formatOpenRouterModelLabel(entry.id),
        vendor,
        modelId: entry.id,
        resolvedModel: toOpenRouterSelection(entry.id),
        isAlias: false,
        // Featured entries carry their price as a legacy-cache fallback. Search entries omit it:
        // the UI never reads prices, and the separate server-only pricing list covers every model.
        ...(includePricing ? { upstreamPrice: normalizeOpenRouterPricing(entry.pricing) } : {}),
    }
}

function buildOpenRouterModels(entries, options = {}) {
    const featuredPerVendor =
        Number.isInteger(options.featuredPerVendor) && options.featuredPerVendor > 0
            ? options.featuredPerVendor
            : OPENROUTER_FEATURED_MODELS_PER_VENDOR
    const usable = (Array.isArray(entries) ? entries : []).filter(isCodexCompatibleOpenRouterModel)

    const ranked = usable
        .map(entry => ({
            entry,
            vendor: openRouterVendor(entry.id),
            created: Number(entry.created) || 0,
        }))
        .sort((a, b) => {
            const rankA = OPENROUTER_VENDOR_ORDER.indexOf(a.vendor)
            const rankB = OPENROUTER_VENDOR_ORDER.indexOf(b.vendor)
            if (rankA !== rankB) {
                return (
                    (rankA === -1 ? OPENROUTER_VENDOR_ORDER.length : rankA) -
                    (rankB === -1 ? OPENROUTER_VENDOR_ORDER.length : rankB)
                )
            }
            // Newest first inside a vendor, so a fresh DeepSeek release is at the top on day one.
            if (a.created !== b.created) return b.created - a.created
            return a.entry.id.localeCompare(b.entry.id)
        })

    const featured = []
    for (const vendor of OPENROUTER_VENDOR_ORDER) {
        const vendorModels = ranked.filter(model => model.vendor === vendor)
        if (!vendorModels.length) continue

        // Variants such as :free and :batch remain searchable, but a canonical model is the less
        // surprising default recommendation whenever the vendor exposes one.
        const canonical = vendorModels.filter(model => !model.entry.id.includes(':'))
        const candidates = canonical.length ? canonical : vendorModels
        const newest = candidates[0]
        const bestAgentic = candidates
            .filter(model => openRouterAgenticScore(model.entry) !== null)
            .sort((a, b) => {
                const scoreDifference = openRouterAgenticScore(b.entry) - openRouterAgenticScore(a.entry)
                if (scoreDifference) return scoreDifference
                if (a.created !== b.created) return b.created - a.created
                return a.entry.id.localeCompare(b.entry.id)
            })[0]

        for (const model of [newest, bestAgentic]) {
            if (!model || featured.some(item => item.entry.id === model.entry.id)) continue
            featured.push(model)
            if (featured.filter(item => item.vendor === vendor).length >= featuredPerVendor) break
        }
    }

    const effectiveFeatured = featured.length ? featured : ranked.slice(0, OPENROUTER_FEATURED_MODELS_PER_VENDOR)
    const searchModels = ranked.map(({ entry, vendor }) => toOpenRouterModel(entry, vendor, false))
    return {
        models: effectiveFeatured.map(({ entry, vendor }) => toOpenRouterModel(entry, vendor)),
        searchModels,
        pricing: buildOpenRouterPricing(entries),
        total: ranked.length,
        truncated: ranked.length > effectiveFeatured.length,
    }
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
    [OPENROUTER_PROVIDER]: {
        keyField: 'OPENROUTER_API_KEY',
        url: 'https://openrouter.ai/api/v1/models',
        headers: apiKey => (apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        // OpenRouter's model list is a public endpoint. Discovering without the platform key keeps
        // the Settings screen honest during provisioning; whether a run can actually *use* a model
        // is a separate question, answered by `available` below.
        optionalKey: true,
    },
}

function extractModelEntries(payload) {
    const list = payload && Array.isArray(payload.data) ? payload.data : []
    return list.filter(entry => entry && typeof entry.id === 'string')
}

function extractModelIds(payload) {
    return extractModelEntries(payload).map(entry => entry.id)
}

function readEnv(options = {}) {
    if (options.env) return options.env
    try {
        return require('../envFunctionsHelper').getEnvFunctions() || {}
    } catch (_) {
        return {}
    }
}

/** Whether a VM run could actually reach OpenRouter (platform key present). */
function isOpenRouterConfigured(options = {}) {
    const env = readEnv(options)
    return !!(env && env[PROVIDER_DISCOVERY[OPENROUTER_PROVIDER].keyField])
}

/**
 * Hit the provider's models endpoint with the platform key. Returns the raw entry list.
 * Throws on any failure — callers fall back to cache/static.
 */
async function fetchProviderModelEntries(provider, options = {}) {
    const config = PROVIDER_DISCOVERY[provider]
    if (!config) throw new Error(`Unknown provider "${provider}".`)

    const env = readEnv(options)
    const apiKey = env && env[config.keyField]
    if (!apiKey && !config.optionalKey) throw new Error(`Missing ${config.keyField} for VM model discovery.`)

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
        return extractModelEntries(await response.json())
    } finally {
        if (timer) clearTimeout(timer)
    }
}

/** Back-compat wrapper: the two agent catalogs only ever needed the ids. */
async function fetchProviderModelIds(provider, options = {}) {
    return (await fetchProviderModelEntries(provider, options)).map(entry => entry.id)
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
        return {
            families: data.families,
            fetchedAt: data.fetchedAt || 0,
            source: 'cache',
            ...(typeof data.total === 'number' ? { total: data.total } : {}),
            ...(typeof data.truncated === 'boolean' ? { truncated: data.truncated } : {}),
            ...(Array.isArray(data.searchModels) ? { searchModels: data.searchModels } : {}),
            // Carried through so a cache hit can still price a run. Without this the projection
            // silently drops the price list and every cached-catalog job falls back to the Sol base
            // rate — i.e. the live pricing path would only ever work on the one request that
            // refreshed the catalog, which is the majority of runs mispriced and nothing to show it.
            ...(Array.isArray(data.pricing) ? { pricing: data.pricing } : {}),
        }
    } catch (error) {
        console.warn('🖥️ VM MODELS: Failed reading cached model catalog', { provider, error: error.message })
        return null
    }
}

async function writeCachedCatalog(provider, families, fetchedAt, extra = {}) {
    try {
        await catalogRef(provider).set({ families, fetchedAt, provider, ...extra }, { merge: true })
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
    if (!CATALOG_PROVIDERS.includes(provider)) throw new Error(`Unknown provider "${provider}".`)

    const isOpenRouter = provider === OPENROUTER_PROVIDER
    // Whether a run can reach OpenRouter is a config fact, not a discovery result, so it is
    // decorated onto every branch below — including the cached ones.
    //
    // The `pricing` list is also stripped here unless a server-side caller explicitly asks for it.
    // It covers every discovered model (hundreds of entries) and exists purely so `startVmJob` can
    // price a run; this catalog is returned verbatim to the client by `getVmAgentModelOptions` and
    // `getVmAgentSettings`, and shipping a few tens of KB of prices the UI never reads on every
    // Settings load would be pure waste.
    const decorate = catalog => {
        if (!isOpenRouter) return catalog
        const decorated = { ...catalog, available: isOpenRouterConfigured(options) }
        if (!options.includePricing) delete decorated.pricing
        return decorated
    }

    const now = typeof options.now === 'number' ? options.now : Date.now()
    const cached = options.forceRefresh ? null : await readCachedCatalog(provider)
    // Refresh the first old-shape OpenRouter cache after this search index shipped instead of
    // making users wait up to 12 hours for search to appear after deployment.
    const hasCurrentOpenRouterShape = !isOpenRouter || Array.isArray(cached?.searchModels)
    if (isFresh(cached, now) && hasCurrentOpenRouterShape) return decorate({ ...cached, source: 'cache' })

    try {
        const entries = await fetchProviderModelEntries(provider, options)
        if (isOpenRouter) {
            const { models, searchModels, pricing, total, truncated } = buildOpenRouterModels(entries, options)
            if (models.length) {
                await writeCachedCatalog(provider, models, now, { total, truncated, searchModels, pricing })
                return decorate({
                    families: models,
                    searchModels,
                    fetchedAt: now,
                    source: 'live',
                    total,
                    truncated,
                    pricing,
                })
            }
            console.warn('🖥️ VM MODELS: OpenRouter discovery returned no compatible models', {
                provider,
                count: entries.length,
            })
        } else {
            const families = buildFamilies(
                provider,
                entries.map(entry => entry.id)
            )
            if (families.length) {
                await writeCachedCatalog(provider, families, now)
                return { families, fetchedAt: now, source: 'live' }
            }
            console.warn('🖥️ VM MODELS: Discovery returned no usable families', { provider, count: entries.length })
        }
    } catch (error) {
        console.warn('🖥️ VM MODELS: Live model discovery failed', { provider, error: error.message })
    }

    // Stale beats static: a 3-day-old real catalog is closer to the truth than our hardcoded one.
    if (cached) return decorate({ ...cached, source: 'stale' })
    return decorate({ families: FALLBACK_CATALOGS[provider].families, fetchedAt: 0, source: 'fallback' })
}

async function getAllModelCatalogs(options = {}) {
    const [claude, codex, openrouter] = await Promise.all(
        CATALOG_PROVIDERS.map(provider => getModelCatalog(provider, options))
    )
    return { claude, codex, openrouter }
}

function isValidFamilyId(familyId) {
    return typeof familyId === 'string' && /^[a-z][a-z0-9]{0,31}$/.test(familyId)
}

/**
 * A saved "default model" value: either an agent family id ('sonnet', 'sol') or an OpenRouter
 * model selection ('openrouter:deepseek/deepseek-chat'). Both live in the same per-agent settings
 * slot, so both have to pass the same gate.
 */
function isValidModelSelection(value) {
    return isValidFamilyId(value) || !!parseOpenRouterSelection(value)
}

/**
 * Turn a saved preference into the model string the run should use.
 *
 * An OpenRouter selection resolves against the OpenRouter catalog regardless of which agent asked,
 * because it is a Codex *source*, not a Claude option — `normalizeAgentModel` still refuses to pair
 * it with Claude, so an impossible combination cannot reach the CLI.
 * Returns null when unknown, so callers keep their existing default.
 */
async function resolveFamilyToModel(provider, familyId, options = {}) {
    if (isOpenRouterSelection(familyId)) {
        const modelId = parseOpenRouterSelection(familyId)
        if (!modelId) return null
        const catalog = await getModelCatalog(OPENROUTER_PROVIDER, options)
        const availableModels = [...(catalog.families || []), ...(catalog.searchModels || [])]
        const match = availableModels.find(model => model.id === familyId)
        if (match) return match.resolvedModel || toOpenRouterSelection(match.modelId || modelId)
        // Degraded discovery must not silently downgrade the user to a different vendor's model.
        // The id is well-formed and OpenRouter resolves it itself, so pass it through.
        return toOpenRouterSelection(modelId)
    }

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
    CATALOG_PROVIDERS,
    OPENROUTER_PROVIDER,
    OPENROUTER_FEATURED_MODELS_PER_VENDOR,
    CLAUDE_CLI_ALIAS_FAMILIES,
    FALLBACK_CATALOGS,
    parseModelId,
    buildFamilies,
    buildOpenRouterModels,
    buildOpenRouterPricing,
    normalizeOpenRouterPricing,
    getOpenRouterUpstreamPrice,
    isCodexCompatibleOpenRouterModel,
    isOpenRouterConfigured,
    fetchProviderModelIds,
    fetchProviderModelEntries,
    getModelCatalog,
    getAllModelCatalogs,
    resolveFamilyToModel,
    isValidFamilyId,
    isValidModelSelection,
}
