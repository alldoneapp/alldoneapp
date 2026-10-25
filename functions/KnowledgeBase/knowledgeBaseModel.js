'use strict'

// Project wiki (a Karpathy-style knowledge base): markdown pages an LLM compiles from a
// project's tasks, goals, notes and contacts, and from documents members add to it, kept current
// by scheduled ingest runs and read by the project's assistants. One tree per project:
//
//   knowledgeBases/{projectId}                                 settings + run state
//   knowledgeBases/{projectId}/pages/{pageId}                  one compiled markdown page
//   knowledgeBases/{projectId}/pages/{pageId}/revisions/{id}   every change, with its run and reason
//   knowledgeBases/{projectId}/corrections/{id}                user corrections, a source of their own
//   knowledgeBases/{projectId}/documents/{id}                  files members added, as extracted text
//   knowledgeBases/{projectId}/runs/{runId}                    ingest runs (the wiki's log)
//
// The whole tree has ONE audience, the project's members, because only sources every member
// may read are compiled into it (see collectKnowledgeSources.js). Members read it; only Cloud
// Functions write it, settings included (setKnowledgeBaseSettings).
//
// Deliberately not notes: notes are content users write, the wiki is derived data that can be
// rebuilt from its sources. As notes, every ingest run would notify followers, re-download and
// re-index each page, and every notes list in the app would have to filter the pages out again.
// The wiki does appear in the Updates feed, but on its own terms: one line per revision, no page
// text, and no unread badge for the changes nobody in the project made (knowledgeWikiFeed.js).

const {
    SELECTABLE_ASSISTANT_MODELS,
    normalizeSelectableAssistantModelKey,
} = require('../Assistant/selectableAssistantModels')

const KNOWLEDGE_BASES_COLLECTION = 'knowledgeBases'
const KNOWLEDGE_PAGES_COLLECTION = 'pages'
const KNOWLEDGE_PAGE_REVISIONS_COLLECTION = 'revisions'
const KNOWLEDGE_CORRECTIONS_COLLECTION = 'corrections'
const KNOWLEDGE_DOCUMENTS_COLLECTION = 'documents'
const KNOWLEDGE_RUNS_COLLECTION = 'runs'

const KNOWLEDGE_PAGE_SLUG_MAX_CHARS = 80
const KNOWLEDGE_PAGE_TITLE_MAX_CHARS = 120
// The summary is the page's line in the index every assistant prompt carries, so it is short.
const KNOWLEDGE_PAGE_SUMMARY_MAX_CHARS = 200
// A page well under Firestore's 1 MiB document limit, and small enough that reading one costs
// an assistant a few thousand tokens rather than a whole context window.
const KNOWLEDGE_PAGE_MAX_CHARS = 20000
const KNOWLEDGE_BASE_MAX_PAGES = 150
const KNOWLEDGE_BASE_INSTRUCTIONS_MAX_CHARS = 4000

const DEFAULT_KNOWLEDGE_BASE_MODEL = 'MODEL_DEEPSEEK_V4_FLASH'
const DEFAULT_KNOWLEDGE_BASE_MONTHLY_GOLD_CAP = 500
const MIN_KNOWLEDGE_BASE_MONTHLY_GOLD_CAP = 50
const MAX_KNOWLEDGE_BASE_MONTHLY_GOLD_CAP = 100000
const KNOWLEDGE_BASE_REFRESH_COOLDOWN_MS = 10 * 60 * 1000
// Who switched a wiki on. A member's choice is theirs to undo (enabledBy 'member', or no field at
// all on the wikis that predate the default); a wiki the default switched on (knowledgeBaseDefaults.js)
// may move to another active member once its payer has gone.
const KNOWLEDGE_BASE_ENABLED_BY_MEMBER = 'member'
const KNOWLEDGE_BASE_ENABLED_BY_DEFAULT = 'default'
const KNOWLEDGE_BASE_OWNER_INACTIVE_STOP_REASON = 'owner_inactive'
const KNOWLEDGE_BASE_MONTHLY_CAP_STOP_REASON = 'monthly_cap'
// A document's text is stored inside its Firestore document, so it stays well under the 1 MiB limit
// even at three bytes a character. About 30,000 tokens: a long deck, a short report.
const KNOWLEDGE_DOCUMENT_MAX_CHARS = 120000
const KNOWLEDGE_DOCUMENT_TITLE_MAX_CHARS = 200
const KNOWLEDGE_DOCUMENT_INSTRUCTIONS_MAX_CHARS = 1000

const KNOWLEDGE_SOURCE_TYPES = ['task', 'goal', 'note', 'contact', 'correction', 'document']

// Object collections name their types in the plural (`tasks`); source keys use the singular.
const OBJECT_TYPE_TO_SOURCE_TYPE = {
    tasks: 'task',
    task: 'task',
    goals: 'goal',
    goal: 'goal',
    notes: 'note',
    note: 'note',
    contacts: 'contact',
    contact: 'contact',
}

const SOURCE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const SOURCE_TOKEN_PATTERN = /^(task|goal|note|contact|correction|document):([A-Za-z0-9_-]{1,128})$/
// [[slug]], [[slug|Label]], [[task:ID]] and [[task:ID|Label]]. No brackets, pipes or line
// breaks inside, so a stray "[[" in prose can never swallow the rest of a page.
const KNOWLEDGE_TOKEN_REGEX = /\[\[([^[\]\n|]{1,200})(?:\|([^[\]\n]{1,200}))?\]\]/g

function getKnowledgeBasePath(projectId) {
    return `${KNOWLEDGE_BASES_COLLECTION}/${projectId}`
}

function getKnowledgePagesPath(projectId) {
    return `${getKnowledgeBasePath(projectId)}/${KNOWLEDGE_PAGES_COLLECTION}`
}

function getKnowledgePagePath(projectId, pageId) {
    return `${getKnowledgePagesPath(projectId)}/${pageId}`
}

function getKnowledgePageRevisionsPath(projectId, pageId) {
    return `${getKnowledgePagePath(projectId, pageId)}/${KNOWLEDGE_PAGE_REVISIONS_COLLECTION}`
}

function getKnowledgeCorrectionsPath(projectId) {
    return `${getKnowledgeBasePath(projectId)}/${KNOWLEDGE_CORRECTIONS_COLLECTION}`
}

function getKnowledgeDocumentsPath(projectId) {
    return `${getKnowledgeBasePath(projectId)}/${KNOWLEDGE_DOCUMENTS_COLLECTION}`
}

function getKnowledgeRunsPath(projectId) {
    return `${getKnowledgeBasePath(projectId)}/${KNOWLEDGE_RUNS_COLLECTION}`
}

// A page's slug is also its document id, so it must be stable and Firestore-safe: lowercase
// ASCII, digits and single hyphens. Accents are folded ("Übersicht" -> "ubersicht") rather than
// dropped, so a German title still yields a readable slug.
function normalizeKnowledgePageSlug(value) {
    const folded = String(value || '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    return folded.slice(0, KNOWLEDGE_PAGE_SLUG_MAX_CHARS).replace(/-+$/g, '')
}

function toKnowledgeSourceType(objectType) {
    return OBJECT_TYPE_TO_SOURCE_TYPE[String(objectType || '').trim()] || null
}

function buildKnowledgeSourceKey(type, id) {
    const sourceType = KNOWLEDGE_SOURCE_TYPES.includes(type) ? type : toKnowledgeSourceType(type)
    if (!sourceType || !SOURCE_ID_PATTERN.test(String(id || ''))) return null
    return `${sourceType}:${id}`
}

function parseKnowledgeSourceKey(key) {
    const match = SOURCE_TOKEN_PATTERN.exec(String(key || '').trim())
    return match ? { type: match[1], id: match[2] } : null
}

function isKnowledgeSourceKey(key) {
    return parseKnowledgeSourceKey(key) !== null
}

function classifyKnowledgeToken(inner) {
    const trimmed = String(inner || '').trim()
    const source = parseKnowledgeSourceKey(trimmed)
    if (source) return { kind: 'source', key: `${source.type}:${source.id}`, ...source }
    const slug = normalizeKnowledgePageSlug(trimmed)
    return slug ? { kind: 'page', slug } : null
}

// Every wiki link and source reference a page body contains, de-duplicated in order of
// appearance.
function extractKnowledgeTokens(markdown) {
    const pageLinks = []
    const sourceKeys = []
    for (const match of String(markdown || '').matchAll(KNOWLEDGE_TOKEN_REGEX)) {
        const token = classifyKnowledgeToken(match[1])
        if (!token) continue
        if (token.kind === 'source' && !sourceKeys.includes(token.key)) sourceKeys.push(token.key)
        if (token.kind === 'page' && !pageLinks.includes(token.slug)) pageLinks.push(token.slug)
    }
    return { pageLinks, sourceKeys }
}

// Drops source references the caller does not allow, keeping their label as plain text so the
// sentence still reads. This is how a page is kept from citing an object its readers may not see,
// or one the model made up: the reference is validated against the sources of the run, never
// trusted as written.
function rewriteKnowledgeSourceTokens(markdown, isAllowedSourceKey) {
    const removed = []
    const text = String(markdown || '').replace(KNOWLEDGE_TOKEN_REGEX, (whole, inner, label) => {
        const token = classifyKnowledgeToken(inner)
        if (!token || token.kind !== 'source') return whole
        if (isAllowedSourceKey(token.key)) return whole
        if (!removed.includes(token.key)) removed.push(token.key)
        return label ? label.trim() : ''
    })
    return { text, removed }
}

// A page waiting for a rebuild still contains what the source it lost contributed, so it is
// shown to nobody, people or assistants, until the rebuild has run.
function isKnowledgePageVisible(page) {
    return !!page && page.archived !== true && page.needsRebuild !== true
}

// A stored model key is validated on every read, never trusted: an unknown key would be routed
// to some default model while its Gold rate resolves to nothing, i.e. it would run for free.
function resolveKnowledgeBaseModel(storedModel) {
    const normalized = normalizeSelectableAssistantModelKey(storedModel)
    return SELECTABLE_ASSISTANT_MODELS.some(option => option.model === normalized)
        ? normalized
        : DEFAULT_KNOWLEDGE_BASE_MODEL
}

function resolveKnowledgeBaseMonthlyGoldCap(storedCap) {
    const cap = Number(storedCap)
    if (!Number.isInteger(cap)) return DEFAULT_KNOWLEDGE_BASE_MONTHLY_GOLD_CAP
    return Math.min(MAX_KNOWLEDGE_BASE_MONTHLY_GOLD_CAP, Math.max(MIN_KNOWLEDGE_BASE_MONTHLY_GOLD_CAP, cap))
}

class KnowledgeBaseSettingsError extends Error {}

// Validates the settings a member may change. Unknown fields are ignored rather than rejected so
// an older client cannot break the call; every field present is validated strictly.
function normalizeKnowledgeBaseSettingsInput(input) {
    const settings = input && typeof input === 'object' ? input : {}
    const patch = {}

    if (settings.enabled !== undefined) {
        if (typeof settings.enabled !== 'boolean') throw new KnowledgeBaseSettingsError('enabled must be a boolean.')
        patch.enabled = settings.enabled
    }

    if (settings.instructions !== undefined) {
        if (typeof settings.instructions !== 'string') {
            throw new KnowledgeBaseSettingsError('instructions must be a string.')
        }
        const instructions = settings.instructions.trim()
        if (instructions.length > KNOWLEDGE_BASE_INSTRUCTIONS_MAX_CHARS) {
            throw new KnowledgeBaseSettingsError(
                `instructions must be at most ${KNOWLEDGE_BASE_INSTRUCTIONS_MAX_CHARS} characters.`
            )
        }
        patch.instructions = instructions
    }

    if (settings.model !== undefined) {
        const model = normalizeSelectableAssistantModelKey(settings.model)
        if (!SELECTABLE_ASSISTANT_MODELS.some(option => option.model === model)) {
            throw new KnowledgeBaseSettingsError('model is not an available assistant model.')
        }
        patch.model = model
    }

    if (settings.monthlyGoldCap !== undefined) {
        const cap = Number(settings.monthlyGoldCap)
        if (
            !Number.isInteger(cap) ||
            cap < MIN_KNOWLEDGE_BASE_MONTHLY_GOLD_CAP ||
            cap > MAX_KNOWLEDGE_BASE_MONTHLY_GOLD_CAP
        ) {
            throw new KnowledgeBaseSettingsError(
                `monthlyGoldCap must be a whole number between ${MIN_KNOWLEDGE_BASE_MONTHLY_GOLD_CAP} and ${MAX_KNOWLEDGE_BASE_MONTHLY_GOLD_CAP}.`
            )
        }
        patch.monthlyGoldCap = cap
    }

    return patch
}

// A wiki whose payer has not used Alldone for 30 days stops running until they are back: the run
// clears nextRunAt and records why, and the default switch-on schedules it again.
function isKnowledgeBasePausedForInactiveOwner(data = {}) {
    return (
        data.enabled === true &&
        !Number.isFinite(data.nextRunAt) &&
        data.lastRunStopReason === KNOWLEDGE_BASE_OWNER_INACTIVE_STOP_REASON
    )
}

// The month a wiki's Gold counter belongs to. UTC, like the reset on the first of the month.
function getKnowledgeBaseMonthKey(now = Date.now()) {
    return new Date(now).toISOString().slice(0, 7)
}

function getKnowledgeBaseMonthlyGoldSpent(data = {}, now = Date.now()) {
    return data?.monthlyGold?.month === getKnowledgeBaseMonthKey(now) ? Number(data.monthlyGold.spent) || 0 : 0
}

// A run that reaches the monthly cap schedules the next one for the first of next month. Until then
// the wiki stands still, and raising the cap above what this month has spent is what ends that early
// (knowledgeBaseSettings.js).
function isKnowledgeBasePausedAtMonthlyCap(data = {}, now = Date.now()) {
    return (
        data.enabled === true &&
        data.lastRunStopReason === KNOWLEDGE_BASE_MONTHLY_CAP_STOP_REASON &&
        data.monthlyGold?.month === getKnowledgeBaseMonthKey(now) &&
        Number.isFinite(data.nextRunAt) &&
        data.nextRunAt > now
    )
}

// What a client may see of the settings document. Run state (cursor, lease) stays out of it.
function toKnowledgeBaseSettingsView(projectId, data = {}, now = Date.now()) {
    return {
        projectId,
        enabled: data.enabled === true,
        enabledByDefault: data.enabled === true && data.enabledBy === KNOWLEDGE_BASE_ENABLED_BY_DEFAULT,
        pausedForInactiveOwner: isKnowledgeBasePausedForInactiveOwner(data),
        pausedAtMonthlyCap: isKnowledgeBasePausedAtMonthlyCap(data, now),
        instructions: typeof data.instructions === 'string' ? data.instructions : '',
        model: resolveKnowledgeBaseModel(data.model),
        monthlyGoldCap: resolveKnowledgeBaseMonthlyGoldCap(data.monthlyGoldCap),
        ownerUserId: data.ownerUserId || null,
        nextRunAt: Number.isFinite(data.nextRunAt) ? data.nextRunAt : null,
        lastRunAt: Number.isFinite(data.lastRunAt) ? data.lastRunAt : null,
    }
}

// Conservative token estimate for budgeting prompts: it must never under-count, because an
// under-count is what overflows a request. ASCII averages ~4 characters per token; anything
// else is counted as a token per character, which over-counts accented Latin and is about right
// for CJK.
function estimateTextTokens(text) {
    const value = String(text || '')
    let ascii = 0
    let other = 0
    for (const character of value) {
        if (character.charCodeAt(0) < 128) ascii += 1
        else other += 1
    }
    return Math.ceil(ascii / 3.5 + other)
}

module.exports = {
    KNOWLEDGE_BASES_COLLECTION,
    KNOWLEDGE_PAGES_COLLECTION,
    KNOWLEDGE_PAGE_REVISIONS_COLLECTION,
    KNOWLEDGE_CORRECTIONS_COLLECTION,
    KNOWLEDGE_DOCUMENTS_COLLECTION,
    KNOWLEDGE_RUNS_COLLECTION,
    KNOWLEDGE_PAGE_SLUG_MAX_CHARS,
    KNOWLEDGE_PAGE_TITLE_MAX_CHARS,
    KNOWLEDGE_PAGE_SUMMARY_MAX_CHARS,
    KNOWLEDGE_PAGE_MAX_CHARS,
    KNOWLEDGE_BASE_MAX_PAGES,
    KNOWLEDGE_BASE_INSTRUCTIONS_MAX_CHARS,
    DEFAULT_KNOWLEDGE_BASE_MODEL,
    DEFAULT_KNOWLEDGE_BASE_MONTHLY_GOLD_CAP,
    MIN_KNOWLEDGE_BASE_MONTHLY_GOLD_CAP,
    MAX_KNOWLEDGE_BASE_MONTHLY_GOLD_CAP,
    KNOWLEDGE_BASE_REFRESH_COOLDOWN_MS,
    KNOWLEDGE_BASE_ENABLED_BY_MEMBER,
    KNOWLEDGE_BASE_ENABLED_BY_DEFAULT,
    KNOWLEDGE_BASE_OWNER_INACTIVE_STOP_REASON,
    KNOWLEDGE_BASE_MONTHLY_CAP_STOP_REASON,
    KNOWLEDGE_DOCUMENT_MAX_CHARS,
    KNOWLEDGE_DOCUMENT_TITLE_MAX_CHARS,
    KNOWLEDGE_DOCUMENT_INSTRUCTIONS_MAX_CHARS,
    KNOWLEDGE_SOURCE_TYPES,
    KnowledgeBaseSettingsError,
    getKnowledgeBasePath,
    getKnowledgePagesPath,
    getKnowledgePagePath,
    getKnowledgePageRevisionsPath,
    getKnowledgeCorrectionsPath,
    getKnowledgeDocumentsPath,
    getKnowledgeRunsPath,
    normalizeKnowledgePageSlug,
    toKnowledgeSourceType,
    buildKnowledgeSourceKey,
    parseKnowledgeSourceKey,
    isKnowledgeSourceKey,
    extractKnowledgeTokens,
    rewriteKnowledgeSourceTokens,
    isKnowledgePageVisible,
    isKnowledgeBasePausedForInactiveOwner,
    getKnowledgeBaseMonthKey,
    getKnowledgeBaseMonthlyGoldSpent,
    isKnowledgeBasePausedAtMonthlyCap,
    resolveKnowledgeBaseModel,
    resolveKnowledgeBaseMonthlyGoldCap,
    normalizeKnowledgeBaseSettingsInput,
    toKnowledgeBaseSettingsView,
    estimateTextTokens,
}
