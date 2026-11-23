const {
    DAY_MS,
    MAX_NEWS_TOPICS,
    NEWS_SCREENING_DUE_AFTER_MS,
    getNewsPageTexts,
    getNewsScreeningPausedSince,
    isManagedNewsSlug,
    isNewsPageHiddenFromAssistants,
    isNewsScreeningActive,
    isNewsScreeningDue,
    normalizeNewsTopicsInput,
    resolveNewsScreeningSettings,
    resolveNewsSearchLanguages,
    toNewsScreeningView,
    WEB_SEARCH_GOLD,
} = require('./knowledgeNewsModel')
const { normalizeKnowledgeBaseSettingsInput, toKnowledgeBaseSettingsView } = require('./knowledgeBaseModel')

const NOW = Date.UTC(2026, 10, 23, 12)

describe('news screening settings (AT-3126)', () => {
    it('is on by default for every wiki that is on, without a migration', () => {
        expect(resolveNewsScreeningSettings({})).toMatchObject({ enabled: true, topics: null })
        expect(isNewsScreeningActive({ enabled: true })).toBe(true)
        // Only while the wiki runs: the screening is a step of the wiki run.
        expect(isNewsScreeningActive({ enabled: false })).toBe(false)
        expect(isNewsScreeningActive({ enabled: true, newsScreening: { enabled: false } })).toBe(false)
    })

    it('is due once a day, so an afternoon "Update now" does not search twice', () => {
        expect(isNewsScreeningDue({ enabled: true }, NOW)).toBe(true)
        const ranTonight = { enabled: true, newsScreeningState: { lastRunAt: NOW - 9 * 60 * 60 * 1000 } }
        expect(isNewsScreeningDue(ranTonight, NOW)).toBe(false)
        const ranLastNight = { enabled: true, newsScreeningState: { lastRunAt: NOW - NEWS_SCREENING_DUE_AFTER_MS } }
        expect(isNewsScreeningDue(ranLastNight, NOW)).toBe(true)
    })

    it("searches in the payer's app language plus English, English only once", () => {
        expect(resolveNewsSearchLanguages('de')).toEqual(['de', 'en'])
        expect(resolveNewsSearchLanguages('es')).toEqual(['es', 'en'])
        expect(resolveNewsSearchLanguages('pt-BR')).toEqual(['pt', 'en'])
        expect(resolveNewsSearchLanguages('en')).toEqual(['en'])
        expect(resolveNewsSearchLanguages(undefined)).toEqual(['en'])
        expect(getNewsPageTexts('es').title).toBe('¿Qué está pasando? – Entorno externo')
        expect(getNewsPageTexts('fr').title).toBe(getNewsPageTexts('en').title)
    })

    it('validates the topics a member types and goes back to automatic topics with null', () => {
        expect(normalizeNewsTopicsInput([' KI-Agenten ', 'ki-agenten', 'MCP'])).toEqual(['KI-Agenten', 'MCP'])
        expect(normalizeNewsTopicsInput(null)).toBeNull()
        expect(normalizeNewsTopicsInput([])).toBeNull()
        expect(() => normalizeNewsTopicsInput('MCP')).toThrow('list of strings')
        expect(() => normalizeNewsTopicsInput(Array(MAX_NEWS_TOPICS + 1).fill('x'))).toThrow('at most')
        expect(() => normalizeNewsTopicsInput(['x'.repeat(61)])).toThrow('at most 60')
    })

    it('accepts the news fields in the wiki settings save and rejects malformed ones', () => {
        expect(
            normalizeKnowledgeBaseSettingsInput({
                newsScreeningEnabled: false,
                newsScreeningTopics: ['MCP'],
                newsScreeningDisabledReason: 'too_expensive',
            })
        ).toEqual({
            newsScreeningEnabled: false,
            newsScreeningTopics: ['MCP'],
            newsScreeningDisabledReason: 'too_expensive',
        })
        expect(() => normalizeKnowledgeBaseSettingsInput({ newsScreeningEnabled: 'yes' })).toThrow('boolean')
        expect(() => normalizeKnowledgeBaseSettingsInput({ newsScreeningDisabledReason: 'bored' })).toThrow('one of')
    })

    it('marks managed news pages', () => {
        expect(isManagedNewsSlug('external-news')).toBe(true)
        expect(isManagedNewsSlug('external-news-archive')).toBe(true)
        expect(isManagedNewsSlug('kunden')).toBe(false)
    })

    it('prices a web search at cost', () => {
        expect(WEB_SEARCH_GOLD).toBe(20)
    })
})

describe('a switched-off screening (E4)', () => {
    it('keeps the page and takes it out of the assistants 30 days after it was switched off', () => {
        const off = { enabled: true, newsScreening: { enabled: false, disabledAt: NOW - 10 * DAY_MS } }
        expect(getNewsScreeningPausedSince(off)).toBe(NOW - 10 * DAY_MS)
        expect(isNewsPageHiddenFromAssistants(off, NOW)).toBe(false)
        expect(isNewsPageHiddenFromAssistants(off, NOW + 20 * DAY_MS)).toBe(true)
        expect(isNewsPageHiddenFromAssistants({ enabled: true }, NOW)).toBe(false)
    })

    it('counts switching the whole wiki off as switching the screening off', () => {
        const wikiOff = { enabled: false, disabledAt: NOW - 31 * DAY_MS }
        expect(getNewsScreeningPausedSince(wikiOff)).toBe(NOW - 31 * DAY_MS)
        expect(isNewsPageHiddenFromAssistants(wikiOff, NOW)).toBe(true)
        // No recorded time: long ago, the page leaves the assistants at once.
        expect(getNewsScreeningPausedSince({ enabled: false })).toBe(0)
    })

    it('shows the state in the settings view', () => {
        const view = toKnowledgeBaseSettingsView(
            'p1',
            {
                enabled: true,
                newsScreening: { enabled: false, disabledAt: NOW - DAY_MS, disabledReason: 'too_many' },
                newsScreeningState: {
                    derivedTopics: [{ label: 'KI-Agenten', english: 'AI agents' }],
                    languages: ['de', 'en'],
                    lastRunAt: NOW - 2 * DAY_MS,
                },
            },
            NOW
        ).newsScreening
        expect(view).toMatchObject({
            enabled: false,
            active: false,
            topics: ['KI-Agenten'],
            topicsSource: 'description',
            languages: ['de', 'en'],
            pausedSince: NOW - DAY_MS,
            assistantCutoffAt: NOW + 29 * DAY_MS,
            hiddenFromAssistants: false,
            disabledReason: 'too_many',
        })
    })

    it('says when nothing relevant was found for two weeks', () => {
        const quiet = toNewsScreeningView({
            enabled: true,
            newsScreeningState: { firstRunAt: NOW - 20 * DAY_MS, lastRunAt: NOW },
        })
        expect(quiet.quietForDays).toBe(20)
        const recent = toNewsScreeningView({
            enabled: true,
            newsScreeningState: { firstRunAt: NOW - 20 * DAY_MS, lastPublishedAt: NOW - 2 * DAY_MS, lastRunAt: NOW },
        })
        expect(recent.quietForDays).toBe(0)
    })
})
