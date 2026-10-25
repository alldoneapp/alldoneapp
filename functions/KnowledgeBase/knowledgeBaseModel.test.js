const {
    DEFAULT_KNOWLEDGE_BASE_MODEL,
    DEFAULT_KNOWLEDGE_BASE_MONTHLY_GOLD_CAP,
    KNOWLEDGE_BASE_INSTRUCTIONS_MAX_CHARS,
    KnowledgeBaseSettingsError,
    buildKnowledgeSourceKey,
    estimateTextTokens,
    extractKnowledgeTokens,
    getKnowledgePagePath,
    getKnowledgePageRevisionsPath,
    isKnowledgePageVisible,
    normalizeKnowledgeBaseSettingsInput,
    normalizeKnowledgePageSlug,
    parseKnowledgeSourceKey,
    resolveKnowledgeBaseModel,
    resolveKnowledgeBaseMonthlyGoldCap,
    rewriteKnowledgeSourceTokens,
    toKnowledgeBaseSettingsView,
    toKnowledgeSourceType,
} = require('./knowledgeBaseModel')

describe('knowledge base paths', () => {
    it('keeps every page, revision and log under the one project tree', () => {
        expect(getKnowledgePagePath('p1', 'overview')).toBe('knowledgeBases/p1/pages/overview')
        expect(getKnowledgePageRevisionsPath('p1', 'overview')).toBe('knowledgeBases/p1/pages/overview/revisions')
    })
})

describe('normalizeKnowledgePageSlug', () => {
    it.each([
        ['Projekt-Überblick', 'projekt-uberblick'],
        ['  Kunden & Partner  ', 'kunden-partner'],
        ['Straße', 'strasse'],
        ['Entscheidungen 2026', 'entscheidungen-2026'],
        ['---', ''],
        ['', ''],
    ])('turns %j into %j', (input, expected) => {
        expect(normalizeKnowledgePageSlug(input)).toBe(expected)
    })

    it('caps the slug without leaving a trailing hyphen', () => {
        const slug = normalizeKnowledgePageSlug(`${'a'.repeat(79)} b`)
        expect(slug.length).toBeLessThanOrEqual(80)
        expect(slug.endsWith('-')).toBe(false)
    })
})

describe('source keys', () => {
    it('maps the plural object types the triggers use onto singular source types', () => {
        expect(toKnowledgeSourceType('tasks')).toBe('task')
        expect(toKnowledgeSourceType('contacts')).toBe('contact')
        expect(toKnowledgeSourceType('chats')).toBeNull()
    })

    it('builds and parses keys for Firestore push ids', () => {
        expect(buildKnowledgeSourceKey('tasks', '-OpffOJFeG3jsXRd-GIZ')).toBe('task:-OpffOJFeG3jsXRd-GIZ')
        expect(parseKnowledgeSourceKey('goal:g_1')).toEqual({ type: 'goal', id: 'g_1' })
    })

    it('refuses ids that could break out of a path or a token', () => {
        expect(buildKnowledgeSourceKey('task', 'a/b')).toBeNull()
        expect(buildKnowledgeSourceKey('task', 'a]]b')).toBeNull()
        expect(buildKnowledgeSourceKey('chat', 'abc')).toBeNull()
        expect(parseKnowledgeSourceKey('task:')).toBeNull()
    })
})

describe('knowledge tokens', () => {
    const body = [
        'Siehe [[Kunden & Partner]] und [[entscheidungen|Entscheidungen]].',
        'Beschlossen in [[task:t1|Release planen]], bestätigt in [[note:n1]] und [[task:t1]].',
        'Ein loses [[ ohne Ende und [[]] bleiben Text.',
    ].join('\n')

    it('extracts page links and source references once each', () => {
        expect(extractKnowledgeTokens(body)).toEqual({
            pageLinks: ['kunden-partner', 'entscheidungen'],
            sourceKeys: ['task:t1', 'note:n1'],
        })
    })

    it('drops disallowed source references but keeps their label readable', () => {
        const { text, removed } = rewriteKnowledgeSourceTokens(body, key => key !== 'task:t1')
        expect(removed).toEqual(['task:t1'])
        expect(text).toContain('Beschlossen in Release planen, bestätigt in [[note:n1]] und .')
        expect(text).toContain('[[Kunden & Partner]]')
    })
})

describe('isKnowledgePageVisible', () => {
    it('hides archived pages and pages waiting for a rebuild', () => {
        expect(isKnowledgePageVisible({ title: 'A' })).toBe(true)
        expect(isKnowledgePageVisible({ archived: true })).toBe(false)
        expect(isKnowledgePageVisible({ needsRebuild: true })).toBe(false)
        expect(isKnowledgePageVisible(null)).toBe(false)
    })
})

describe('settings', () => {
    it('validates every field it is given and ignores unknown ones', () => {
        expect(
            normalizeKnowledgeBaseSettingsInput({
                enabled: true,
                instructions: '  Lege eine Seite pro Kunde an.  ',
                model: 'MODEL_GPT6_LUNA',
                monthlyGoldCap: 800,
                somethingElse: 'ignored',
            })
        ).toEqual({
            enabled: true,
            instructions: 'Lege eine Seite pro Kunde an.',
            model: 'MODEL_GPT6_LUNA',
            monthlyGoldCap: 800,
        })
    })

    it('normalizes a renamed model key to its current name', () => {
        expect(normalizeKnowledgeBaseSettingsInput({ model: 'MODEL_GPT5_6_LUNA' })).toEqual({
            model: 'MODEL_GPT6_LUNA',
        })
    })

    it.each([
        [{ enabled: 'yes' }],
        [{ instructions: 42 }],
        [{ instructions: 'x'.repeat(KNOWLEDGE_BASE_INSTRUCTIONS_MAX_CHARS + 1) }],
        [{ model: 'MODEL_THAT_DOES_NOT_EXIST' }],
        [{ monthlyGoldCap: 10 }],
        [{ monthlyGoldCap: 500.5 }],
    ])('rejects %j', input => {
        expect(() => normalizeKnowledgeBaseSettingsInput(input)).toThrow(KnowledgeBaseSettingsError)
    })

    it('treats an unknown stored model as absent rather than routing it somewhere unbilled', () => {
        expect(resolveKnowledgeBaseModel('MODEL_RETIRED')).toBe(DEFAULT_KNOWLEDGE_BASE_MODEL)
        expect(resolveKnowledgeBaseModel(undefined)).toBe(DEFAULT_KNOWLEDGE_BASE_MODEL)
        expect(resolveKnowledgeBaseModel('MODEL_GPT6_SOL')).toBe('MODEL_GPT6_SOL')
    })

    it('clamps a stored cap into the allowed range', () => {
        expect(resolveKnowledgeBaseMonthlyGoldCap(undefined)).toBe(DEFAULT_KNOWLEDGE_BASE_MONTHLY_GOLD_CAP)
        expect(resolveKnowledgeBaseMonthlyGoldCap(1)).toBe(50)
        expect(resolveKnowledgeBaseMonthlyGoldCap(10 ** 9)).toBe(100000)
    })

    it('keeps run state out of the client view', () => {
        const view = toKnowledgeBaseSettingsView('p1', {
            enabled: true,
            cursor: { tasks: { ms: 1, ids: [] } },
            leaseOwner: 'run-1',
            ownerUserId: 'u1',
        })
        expect(view).not.toHaveProperty('cursor')
        expect(view).not.toHaveProperty('leaseOwner')
        expect(view).toMatchObject({ projectId: 'p1', enabled: true, ownerUserId: 'u1' })
    })

    it('tells a wiki the default switched on, and one paused for an inactive payer, apart', () => {
        const paused = { enabled: true, enabledBy: 'default', nextRunAt: null, lastRunStopReason: 'owner_inactive' }
        expect(toKnowledgeBaseSettingsView('p1', paused)).toMatchObject({
            enabledByDefault: true,
            pausedForInactiveOwner: true,
        })
        // Scheduled again, or switched off: no longer paused, whatever the last run said.
        expect(toKnowledgeBaseSettingsView('p1', { ...paused, nextRunAt: 5 }).pausedForInactiveOwner).toBe(false)
        expect(toKnowledgeBaseSettingsView('p1', { ...paused, enabled: false })).toMatchObject({
            enabledByDefault: false,
            pausedForInactiveOwner: false,
        })
        expect(toKnowledgeBaseSettingsView('p1', { enabled: true }).enabledByDefault).toBe(false)
    })
})

describe('estimateTextTokens', () => {
    it('never under-counts a typical tokenizer', () => {
        // ~4 characters per token for English prose; the estimate must be at least that.
        const prose = 'The project wiki is compiled from tasks, goals, notes and contacts. '.repeat(20)
        expect(estimateTextTokens(prose)).toBeGreaterThanOrEqual(Math.ceil(prose.length / 4))
        // One token per CJK character is the floor for CJK text.
        expect(estimateTextTokens('知識ベース')).toBeGreaterThanOrEqual(5)
    })
})
