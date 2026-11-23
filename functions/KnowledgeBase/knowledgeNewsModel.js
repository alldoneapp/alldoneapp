'use strict'

// Daily news screening of the project wiki (AT-3126): "What's happening? – External environment".
//
// One switch per project. When it is on, the nightly wiki run (knowledgeBaseIngest.js) searches public
// news for a few topics derived from the project description, keeps only verified, dated, relevant
// developments, and the server writes them onto ONE managed wiki page (plus a compact archive page).
// Chats and assistants find that page through the existing wiki index, read and search tools.
//
// Decisions (Karsten, 2026-11-21/23):
//   - no cap of its own: it is billed to the wiki's payer and counted in the wiki's ONE monthly Gold
//     cap, under its own ledger source (`wiki_news_screening`), like the description update;
//   - whoever may change the wiki (canManageKnowledgeBase: the payer, or anyone once the payer left)
//     switches it; no owner/admin rule of its own;
//   - on by default for active projects, without a migration: a missing `newsScreening` field means
//     on, exactly like `descriptionUpdate`. Whether a project is screened is decided at run time
//     (wiki on and running, project active, not a template or guide, payer has not archived it);
//   - external news never changes internal wiki pages or the project description: the managed pages
//     are invisible to the ingest, the rebuilds, the health check and the description update;
//   - switched off (the screening or the whole wiki), the page stays, marked paused, and 30 days later
//     it leaves the assistants' context (index, read, search);
//   - searched in the payer's app language plus English (once, when that IS English), never in a
//     language guessed from the description.
//
// Dependency-free: the web client (wiki settings, wiki view) reads the same rules.

const DAY_MS = 24 * 60 * 60 * 1000

const NEWS_PAGE_SLUG = 'external-news'
const NEWS_ARCHIVE_PAGE_SLUG = 'external-news-archive'
const MANAGED_NEWS_PAGE_SLUGS = [NEWS_PAGE_SLUG, NEWS_ARCHIVE_PAGE_SLUG]
const KNOWLEDGE_NEWS_ITEMS_COLLECTION = 'newsItems'

// Ledger source of everything the screening spends: searches and the assessment conversation.
const NEWS_GOLD_SOURCE = 'wiki_news_screening'
// One web search at cost (Assistant/webSearchPricing.js), the same price as an assistant's web_search.
const { WEB_SEARCH_GOLD } = require('../Assistant/webSearchPricing')

const MAX_NEWS_TOPICS = 6
const NEWS_TOPIC_MAX_CHARS = 60
// At most this many searches a night; topics x languages beyond it rotate over the nights.
const MAX_NEWS_SEARCHES_PER_RUN = 8
const NEWS_RESULTS_PER_SEARCH = 6
const MAX_NEWS_CANDIDATES = 20
const MAX_NEW_NEWS_ENTRIES_PER_RUN = 5
const MIN_PUBLISHED_RELEVANCE = 2
// Due once a day: 18 hours after the last screening, so every nightly run qualifies (also across a
// DST change) but an afternoon "Update now" does not search a second time that day.
const NEWS_SCREENING_DUE_AFTER_MS = 18 * 60 * 60 * 1000
const NEWS_FIRST_RUN_LOOKBACK_DAYS = 14
const NEWS_MAX_LOOKBACK_DAYS = 7
const NEWS_ACTIVE_WINDOW_DAYS = 30
const NEWS_ACTIVE_PAGE_MAX_ENTRIES = 15
const NEWS_ARCHIVE_RETENTION_DAYS = 365
const NEWS_PAUSED_ASSISTANT_GRACE_DAYS = 30
const NEWS_QUIET_HINT_DAYS = 14

const NEWS_DISABLED_REASONS = ['not_relevant', 'too_expensive', 'too_many', 'other']

// The page title and texts in the payer's language. Spanish and the other languages fall back to
// English when there is no translation of their own.
const NEWS_PAGE_TEXTS = {
    de: {
        title: 'Was ist los? – Externes Umfeld',
        summary:
            'Belegte externe Entwicklungen aus öffentlichen Quellen, täglich recherchiert (keine Projektentscheidungen).',
        archiveTitle: 'Was war los? – Archiv externes Umfeld',
        archiveSummary: 'Ältere externe Entwicklungen aus dem News-Screening, nach Monat (12 Monate).',
        intro: 'Externe Entwicklungen aus öffentlichen Quellen, automatisch recherchiert. Keine internen Entscheidungen oder Projektstände. Quellen prüfen, bevor du handelst.',
        topics: 'Suchthemen',
        recent: 'Neu & relevant (letzte 30 Tage)',
        none: 'Zurzeit keine relevanten externen Entwicklungen.',
        older: 'Ältere Entwicklungen',
        what: 'Was',
        why: 'Warum relevant',
        published: 'Veröffentlicht',
        researched: 'Recherchiert',
        updated: 'aktualisiert',
        sources: 'Quellen',
        high: 'hoch',
        medium: 'mittel',
        paused: 'Pausiert seit {date}: Das News-Screening ist ausgeschaltet. Die Einträge werden nicht mehr aktualisiert und ab {hiddenDate} nicht mehr von Assistenten genutzt.',
        archiveIntro: 'Ältere externe Entwicklungen aus dem News-Screening. Aktuelle stehen auf',
    },
    en: {
        title: "What's happening? – External environment",
        summary: 'Verified external developments from public sources, researched daily (not project decisions).',
        archiveTitle: 'What happened? – External environment archive',
        archiveSummary: 'Older external developments from the news screening, by month (12 months).',
        intro: 'External developments from public sources, researched automatically. Not internal decisions or project status. Check the sources before you act.',
        topics: 'Search topics',
        recent: 'New & relevant (last 30 days)',
        none: 'No relevant external developments at the moment.',
        older: 'Older developments',
        what: 'What',
        why: 'Why it matters',
        published: 'Published',
        researched: 'Researched',
        updated: 'updated',
        sources: 'Sources',
        high: 'high',
        medium: 'medium',
        paused: 'Paused since {date}: the news screening is switched off. The entries are no longer updated, and assistants stop using them on {hiddenDate}.',
        archiveIntro: 'Older external developments from the news screening. Current ones are on',
    },
    es: {
        title: '¿Qué está pasando? – Entorno externo',
        summary:
            'Novedades externas verificadas de fuentes públicas, investigadas a diario (no son decisiones del proyecto).',
        archiveTitle: '¿Qué pasó? – Archivo del entorno externo',
        archiveSummary: 'Novedades externas anteriores del monitoreo de noticias, por mes (12 meses).',
        intro: 'Novedades externas de fuentes públicas, investigadas automáticamente. No son decisiones internas ni el estado del proyecto. Revisa las fuentes antes de actuar.',
        topics: 'Temas de búsqueda',
        recent: 'Nuevo y relevante (últimos 30 días)',
        none: 'Por ahora no hay novedades externas relevantes.',
        older: 'Novedades anteriores',
        what: 'Qué',
        why: 'Por qué importa',
        published: 'Publicado',
        researched: 'Investigado',
        updated: 'actualizado',
        sources: 'Fuentes',
        high: 'alta',
        medium: 'media',
        paused: 'En pausa desde {date}: el monitoreo de noticias está desactivado. Las entradas ya no se actualizan y los asistentes dejan de usarlas el {hiddenDate}.',
        archiveIntro: 'Novedades externas anteriores del monitoreo de noticias. Las actuales están en',
    },
}

// Names for the prompts. Any other code is passed on as it is.
const LANGUAGE_NAMES = {
    en: 'English',
    de: 'German',
    es: 'Spanish',
    fr: 'French',
    it: 'Italian',
    pt: 'Portuguese',
    nl: 'Dutch',
    pl: 'Polish',
}

function normalizeLanguageCode(language) {
    const code = String(language || '')
        .trim()
        .toLowerCase()
        .split(/[-_]/)[0]
    return /^[a-z]{2,3}$/.test(code) ? code : 'en'
}

/** The payer's app language plus English, English only once. */
function resolveNewsSearchLanguages(language) {
    const primary = normalizeLanguageCode(language)
    return primary === 'en' ? ['en'] : [primary, 'en']
}

function getLanguageName(code) {
    return LANGUAGE_NAMES[code] || code
}

function getNewsPageTexts(language) {
    return NEWS_PAGE_TEXTS[normalizeLanguageCode(language)] || NEWS_PAGE_TEXTS.en
}

function isManagedNewsSlug(slug) {
    return MANAGED_NEWS_PAGE_SLUGS.includes(String(slug || ''))
}

function getKnowledgeNewsItemsPath(projectId) {
    return `knowledgeBases/${projectId}/${KNOWLEDGE_NEWS_ITEMS_COLLECTION}`
}

function cleanTopic(value) {
    return String(value || '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, NEWS_TOPIC_MAX_CHARS)
        .trim()
}

function normalizeTopicList(list) {
    const seen = new Set()
    const topics = []
    for (const entry of Array.isArray(list) ? list : []) {
        const topic = cleanTopic(entry)
        const key = topic.toLowerCase()
        if (!topic || seen.has(key)) continue
        seen.add(key)
        topics.push(topic)
        if (topics.length >= MAX_NEWS_TOPICS) break
    }
    return topics
}

// Missing settings mean the default: on, with automatic topics. Switching it off is a stored
// `enabled: false`; topics a member set are stored, `null` means "derive from the description".
function resolveNewsScreeningSettings(data = {}) {
    const stored = (data && data.newsScreening) || {}
    const topics = Array.isArray(stored.topics) ? normalizeTopicList(stored.topics) : null
    return {
        enabled: stored.enabled !== false,
        topics: topics && topics.length ? topics : null,
        disabledAt: Number.isFinite(stored.disabledAt) ? stored.disabledAt : null,
        disabledReason: NEWS_DISABLED_REASONS.includes(stored.disabledReason) ? stored.disabledReason : null,
    }
}

/** The screening runs only while the wiki itself is on. */
function isNewsScreeningActive(data = {}) {
    return data?.enabled === true && resolveNewsScreeningSettings(data).enabled
}

/**
 * Since when the news page has been standing still because somebody switched it off (the screening,
 * or the whole wiki), or null while it is on. A switch-off without a recorded time (wikis switched off
 * before the field existed) counts as long ago: the page then leaves the assistants' context at once.
 */
function getNewsScreeningPausedSince(data = {}) {
    if (isNewsScreeningActive(data)) return null
    const settings = resolveNewsScreeningSettings(data)
    const candidates = []
    if (!settings.enabled) candidates.push(settings.disabledAt)
    if (data?.enabled !== true) candidates.push(Number.isFinite(data?.disabledAt) ? data.disabledAt : null)
    const known = candidates.filter(Number.isFinite)
    if (known.length !== candidates.length) return 0
    return Math.min(...known)
}

/** When a paused news page leaves the assistants' context, or null while the screening is on. */
function getNewsPageAssistantCutoffAt(data = {}) {
    const pausedSince = getNewsScreeningPausedSince(data)
    return pausedSince === null ? null : pausedSince + NEWS_PAUSED_ASSISTANT_GRACE_DAYS * DAY_MS
}

function isNewsPageHiddenFromAssistants(data = {}, now = Date.now()) {
    const cutoff = getNewsPageAssistantCutoffAt(data)
    return cutoff !== null && now >= cutoff
}

function isNewsScreeningDue(data = {}, now = Date.now()) {
    if (!isNewsScreeningActive(data)) return false
    const last = Number(data?.newsScreeningState?.lastRunAt)
    return !Number.isFinite(last) || now - last >= NEWS_SCREENING_DUE_AFTER_MS
}

class NewsScreeningSettingsError extends Error {}

// Topics a member typed: at most MAX_NEWS_TOPICS, each up to NEWS_TOPIC_MAX_CHARS characters.
// `null` (or an empty list) goes back to the topics derived from the description.
function normalizeNewsTopicsInput(value) {
    if (value === null) return null
    if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
        throw new NewsScreeningSettingsError('newsScreeningTopics must be a list of strings or null.')
    }
    if (value.length > MAX_NEWS_TOPICS) {
        throw new NewsScreeningSettingsError(`newsScreeningTopics may have at most ${MAX_NEWS_TOPICS} topics.`)
    }
    if (value.some(entry => entry.trim().length > NEWS_TOPIC_MAX_CHARS)) {
        throw new NewsScreeningSettingsError(`Each news topic may have at most ${NEWS_TOPIC_MAX_CHARS} characters.`)
    }
    const topics = normalizeTopicList(value)
    return topics.length ? topics : null
}

// What the settings and the wiki view show. Run state beyond this stays on the document.
function toNewsScreeningView(data = {}, now = Date.now()) {
    const settings = resolveNewsScreeningSettings(data)
    const state = (data && data.newsScreeningState) || {}
    const derivedTopics = Array.isArray(state.derivedTopics)
        ? state.derivedTopics.map(topic => cleanTopic(topic?.label)).filter(Boolean)
        : []
    const lastPublishedAt = Number.isFinite(state.lastPublishedAt) ? state.lastPublishedAt : null
    const lastRunAt = Number.isFinite(state.lastRunAt) ? state.lastRunAt : null
    const firstRunAt = Number.isFinite(state.firstRunAt) ? state.firstRunAt : null
    const quietSince = lastPublishedAt || firstRunAt
    return {
        enabled: settings.enabled,
        active: isNewsScreeningActive(data),
        topics: settings.topics || derivedTopics,
        topicsSource: settings.topics ? 'member' : derivedTopics.length ? 'description' : 'none',
        descriptionChangedSinceTopicsEdit: !!settings.topics && state.descriptionChangedSinceTopicsEdit === true,
        languages: Array.isArray(state.languages) ? state.languages : [],
        lastRunAt,
        lastResult: typeof state.lastResult === 'string' ? state.lastResult : null,
        lastSkipReason: typeof state.lastSkipReason === 'string' ? state.lastSkipReason : null,
        lastPublishedAt,
        lastNewEntries: Number(state.lastNewEntries) || 0,
        quietForDays:
            lastRunAt && quietSince && lastRunAt - quietSince >= NEWS_QUIET_HINT_DAYS * DAY_MS
                ? Math.floor((lastRunAt - quietSince) / DAY_MS)
                : 0,
        pausedSince: getNewsScreeningPausedSince(data),
        assistantCutoffAt: getNewsPageAssistantCutoffAt(data),
        hiddenFromAssistants: isNewsPageHiddenFromAssistants(data, now),
        disabledReason: settings.disabledReason,
    }
}

module.exports = {
    DAY_MS,
    NEWS_PAGE_SLUG,
    NEWS_ARCHIVE_PAGE_SLUG,
    MANAGED_NEWS_PAGE_SLUGS,
    KNOWLEDGE_NEWS_ITEMS_COLLECTION,
    NEWS_GOLD_SOURCE,
    WEB_SEARCH_GOLD,
    MAX_NEWS_TOPICS,
    NEWS_TOPIC_MAX_CHARS,
    MAX_NEWS_SEARCHES_PER_RUN,
    NEWS_RESULTS_PER_SEARCH,
    MAX_NEWS_CANDIDATES,
    MAX_NEW_NEWS_ENTRIES_PER_RUN,
    MIN_PUBLISHED_RELEVANCE,
    NEWS_SCREENING_DUE_AFTER_MS,
    NEWS_FIRST_RUN_LOOKBACK_DAYS,
    NEWS_MAX_LOOKBACK_DAYS,
    NEWS_ACTIVE_WINDOW_DAYS,
    NEWS_ACTIVE_PAGE_MAX_ENTRIES,
    NEWS_ARCHIVE_RETENTION_DAYS,
    NEWS_PAUSED_ASSISTANT_GRACE_DAYS,
    NEWS_QUIET_HINT_DAYS,
    NEWS_DISABLED_REASONS,
    NEWS_PAGE_TEXTS,
    NewsScreeningSettingsError,
    normalizeLanguageCode,
    resolveNewsSearchLanguages,
    getLanguageName,
    getNewsPageTexts,
    isManagedNewsSlug,
    getKnowledgeNewsItemsPath,
    cleanTopic,
    normalizeTopicList,
    resolveNewsScreeningSettings,
    isNewsScreeningActive,
    getNewsScreeningPausedSince,
    getNewsPageAssistantCutoffAt,
    isNewsPageHiddenFromAssistants,
    isNewsScreeningDue,
    normalizeNewsTopicsInput,
    toNewsScreeningView,
}
