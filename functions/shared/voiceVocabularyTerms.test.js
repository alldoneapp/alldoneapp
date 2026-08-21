/**
 * Tests for the per-user dictation vocabulary's candidate extraction and ranking (PT-4648).
 *
 * The contract worth defending here is NOT "we collect the user's names" — it is the opposite:
 * Deepgram's guidance is that a generic keyterm dilutes the prompt and costs accuracy on every
 * other word, so most of these tests assert that something is REJECTED. A vocabulary builder that
 * is too eager is worse than no vocabulary at all.
 */

const {
    MAX_DYNAMIC_TERMS,
    SOURCE_WEIGHTS,
    normalizeCandidateTerm,
    stripCompanyLegalForm,
    isDistinctiveTerm,
    extractNameParts,
    extractCandidatesFromProject,
    rankCandidates,
    buildDynamicTerms,
} = require('./voiceVocabularyTerms')

const NOW = 1_700_000_000_000
const DAY = 24 * 60 * 60 * 1000

describe('normalizeCandidateTerm', () => {
    test('collapses whitespace and trims', () => {
        expect(normalizeCandidateTerm('  Anna   Somova  ')).toBe('Anna Somova')
    })

    test('strips characters that would silently break a keyterm on the wire', () => {
        // Deepgram does NOT error on `:` — it accepts the whole string as one literal keyterm and
        // boosts nothing, which is the same silent failure as the legacy `keyterm=term:2` syntax.
        const normalized = normalizeCandidateTerm('Acme: Corp, Ltd; Berlin')
        expect(normalized).not.toMatch(/[:,;]/)
    })

    test('drops emoji and symbol runs, which are not speech', () => {
        expect(normalizeCandidateTerm('🚀 Project Juno 🚀')).toBe('Project Juno')
    })

    test('preserves accents and apostrophes inside names', () => {
        expect(normalizeCandidateTerm('Müller')).toBe('Müller')
        expect(normalizeCandidateTerm("O'Brien")).toBe("O'Brien")
    })

    test('tolerates non-string input', () => {
        expect(normalizeCandidateTerm(undefined)).toBe('')
        expect(normalizeCandidateTerm(42)).toBe('')
        expect(normalizeCandidateTerm(null)).toBe('')
    })
})

describe('stripCompanyLegalForm', () => {
    test('removes a trailing legal form so the distinctive part survives', () => {
        expect(stripCompanyLegalForm('Heyflow GmbH')).toBe('Heyflow')
        expect(stripCompanyLegalForm('Acme Corp')).toBe('Acme')
        // Only the TRAILING run is removed, and the dangling "&" left behind is re-normalized away.
        expect(stripCompanyLegalForm('Contoso Holding GmbH & Co. KG')).toBe('Contoso Holding GmbH')
    })

    test('never strips a company down to nothing', () => {
        // A company literally named after its legal form keeps it rather than vanishing.
        expect(stripCompanyLegalForm('GmbH')).toBe('GmbH')
    })

    test('leaves a company without a legal form untouched', () => {
        expect(stripCompanyLegalForm('Signal Iduna')).toBe('Signal Iduna')
    })
})

describe('isDistinctiveTerm', () => {
    test('accepts distinctive proper nouns and acronyms', () => {
        for (const term of ['Somova', 'Juno', 'JTL', 'Signal Iduna', 'Alldone CTO', 'Müller', "O'Brien"]) {
            expect(isDistinctiveTerm(term)).toBe(true)
        }
    })

    test("rejects Alldone's own domain nouns, the tempting-but-wrong additions", () => {
        // Deepgram warns explicitly that generic words cause false boosts, and these are all
        // transcribed correctly today anyway.
        for (const term of ['Task', 'Goal', 'Note', 'Assistant', 'Project', 'Meeting', 'Inbox']) {
            expect(isDistinctiveTerm(term)).toBe(false)
        }
    })

    test('rejects a phrase made entirely of generic words', () => {
        for (const term of ['New Client Project', 'Personal Notes', 'Test Company', 'Team Lead']) {
            expect(isDistinctiveTerm(term)).toBe(false)
        }
    })

    test('rejects a phrase with no proper-noun-shaped word, even outside the stoplist', () => {
        // The structural check is what generalizes: no stoplist can enumerate every generic phrase.
        expect(isDistinctiveTerm('my project')).toBe(false)
        expect(isDistinctiveTerm('some stuff')).toBe(false)
    })

    test('keeps one distinctive word enough to carry a phrase', () => {
        expect(isDistinctiveTerm('Project Juno')).toBe(true)
    })

    test('rejects terms too short to be acoustically distinctive', () => {
        expect(isDistinctiveTerm('A')).toBe(false)
        expect(isDistinctiveTerm('Q3')).toBe(false)
    })

    test('rejects a sentence fragment rather than a name', () => {
        expect(isDistinctiveTerm('Anna Somova And The Whole Berlin Team')).toBe(false)
        expect(isDistinctiveTerm('X'.repeat(60))).toBe(false)
    })

    test('rejects a bare name particle', () => {
        expect(isDistinctiveTerm('van')).toBe(false)
        expect(isDistinctiveTerm('de')).toBe(false)
    })

    test('keeps a particle inside a real surname', () => {
        expect(isDistinctiveTerm('van der Berg')).toBe(true)
    })

    test('rejects purely numeric candidates', () => {
        expect(isDistinctiveTerm('2026')).toBe(false)
        expect(isDistinctiveTerm('42 42')).toBe(false)
    })

    test('rejects function words from every language `multi` covers', () => {
        for (const term of ['the and for', 'der und mit', 'para con una', 'het een van']) {
            expect(isDistinctiveTerm(term)).toBe(false)
        }
    })

    test('tolerates non-string input', () => {
        expect(isDistinctiveTerm(undefined)).toBe(false)
        expect(isDistinctiveTerm(7)).toBe(false)
    })
})

describe('extractNameParts', () => {
    test('skips the given name, which collides across a contact list', () => {
        // "Somova" is the word a speech model cannot guess; "Anna" is not.
        expect(extractNameParts('Anna Somova', { skipFirstWord: true })).toEqual(['Somova'])
    })

    test('returns nothing for a single-word name', () => {
        expect(extractNameParts('Somova', { skipFirstWord: true })).toEqual([])
    })

    test('filters generic parts out of a project name', () => {
        expect(extractNameParts('JTL Project Juno')).toEqual(['JTL', 'Juno'])
    })
})

describe('extractCandidatesFromProject', () => {
    const candidates = extractCandidatesFromProject({
        projectId: 'p1',
        projectName: 'JTL Project Juno',
        contacts: [{ displayName: 'Anna Somova', company: 'Heyflow GmbH', lastEditionDate: NOW }],
        assistants: [{ displayName: 'Alldone CTO', lastEditionDate: NOW }],
    })
    const termsOf = source => candidates.filter(c => c.source === source).map(c => c.term)

    test('takes the full contact name at the highest weight', () => {
        expect(termsOf('contact')).toEqual(['Anna Somova'])
    })

    test('adds the surname separately, because a phrase keyterm does not boost it alone', () => {
        expect(termsOf('namePart')).toContain('Somova')
        expect(termsOf('namePart')).not.toContain('Anna')
    })

    test('takes the company without its legal form', () => {
        expect(termsOf('company')).toEqual(['Heyflow'])
    })

    test('takes project and assistant names', () => {
        expect(termsOf('project')).toEqual(['JTL Project Juno'])
        expect(termsOf('assistant')).toEqual(['Alldone CTO'])
    })

    test('tolerates missing collections and malformed records', () => {
        expect(() => extractCandidatesFromProject({})).not.toThrow()
        expect(
            extractCandidatesFromProject({
                projectName: '',
                contacts: [null, {}, { displayName: 123 }],
                assistants: [undefined],
            })
        ).toEqual([])
    })
})

describe('rankCandidates', () => {
    test('ranks a contact name above a bare name part', () => {
        expect(SOURCE_WEIGHTS.contact).toBeGreaterThan(SOURCE_WEIGHTS.namePart)
        const ranked = rankCandidates(
            [
                { term: 'Somova', source: 'namePart', lastEditedAt: NOW, projectId: 'p1' },
                { term: 'Anna Somova', source: 'contact', lastEditedAt: NOW, projectId: 'p1' },
            ],
            { now: NOW }
        )
        expect(ranked.map(r => r.term)).toEqual(['Anna Somova', 'Somova'])
    })

    test('ranks a recently edited contact above a stale one', () => {
        const ranked = rankCandidates(
            [
                { term: 'Oldname', source: 'contact', lastEditedAt: NOW - 400 * DAY, projectId: 'p1' },
                { term: 'Freshname', source: 'contact', lastEditedAt: NOW - DAY, projectId: 'p1' },
            ],
            { now: NOW }
        )
        expect(ranked[0].term).toBe('Freshname')
    })

    test('treats a name shared across projects as stronger evidence', () => {
        const ranked = rankCandidates(
            [
                { term: 'Everywhere', source: 'contact', lastEditedAt: 0, projectId: 'p1' },
                { term: 'Everywhere', source: 'contact', lastEditedAt: 0, projectId: 'p2' },
                { term: 'Everywhere', source: 'contact', lastEditedAt: 0, projectId: 'p3' },
                { term: 'Onlyhere', source: 'contact', lastEditedAt: 0, projectId: 'p1' },
            ],
            { now: NOW }
        )
        expect(ranked[0].term).toBe('Everywhere')
        expect(ranked).toHaveLength(2)
    })

    test('deduplicates case-insensitively but keeps the strongest spelling', () => {
        // Deepgram preserves keyterm casing in the transcript, so the contact's own capitalization
        // must survive a lowercase duplicate seen first.
        const ranked = rankCandidates(
            [
                { term: 'somova', source: 'namePart', lastEditedAt: 0, projectId: 'p1' },
                { term: 'Somova', source: 'contact', lastEditedAt: 0, projectId: 'p1' },
            ],
            { now: NOW }
        )
        expect(ranked).toHaveLength(1)
        expect(ranked[0].term).toBe('Somova')
    })

    test('excludes terms already carried by the static glossary', () => {
        const ranked = rankCandidates([{ term: 'Alldone', source: 'project', lastEditedAt: 0, projectId: 'p1' }], {
            now: NOW,
            excludeTerms: ['Alldone'],
        })
        expect(ranked).toHaveLength(0)
    })

    test('is deterministic, so an unchanged workspace produces an unchanged list', () => {
        // Non-determinism here would churn the prompt cache key and make the cached document look
        // like it changed on every rebuild.
        const input = [
            { term: 'Alpha', source: 'contact', lastEditedAt: 0, projectId: 'p1' },
            { term: 'Bravo', source: 'contact', lastEditedAt: 0, projectId: 'p1' },
            { term: 'Charlie', source: 'contact', lastEditedAt: 0, projectId: 'p1' },
        ]
        expect(rankCandidates(input, { now: NOW })).toEqual(rankCandidates([...input].reverse(), { now: NOW }))
    })

    test('treats a future timestamp as clock skew rather than as a signal', () => {
        expect(() =>
            rankCandidates([{ term: 'Skew', source: 'contact', lastEditedAt: NOW + DAY }], { now: NOW })
        ).not.toThrow()
    })

    test('tolerates missing or malformed input', () => {
        expect(rankCandidates(undefined)).toEqual([])
        expect(rankCandidates([null, {}, { term: '' }])).toEqual([])
    })
})

describe('buildDynamicTerms', () => {
    const manyCandidates = Array.from({ length: 100 }, (_, index) => ({
        term: `Distinctname${String.fromCharCode(65 + (index % 26))}${index}`,
        source: 'contact',
        lastEditedAt: NOW - index * DAY,
        projectId: 'p1',
    }))

    test('caps the list so the request cannot grow without bound', () => {
        const built = buildDynamicTerms(manyCandidates, { now: NOW })
        expect(built.terms).toHaveLength(MAX_DYNAMIC_TERMS)
    })

    test('reports what it dropped rather than truncating silently', () => {
        // A silent cap reads as "we included everything" when it did not.
        const built = buildDynamicTerms(manyCandidates, { now: NOW })
        expect(built.rankedCount).toBe(100)
        expect(built.droppedCount).toBe(100 - MAX_DYNAMIC_TERMS)
    })

    test('keeps the combined list inside Deepgram’s recommended 20-50 term band', () => {
        const built = buildDynamicTerms(manyCandidates, { now: NOW })
        const approximateTokens = built.terms.join(' ').split(/\s+/).length
        expect(approximateTokens).toBeLessThan(200) // far under the hard 500-token limit
    })

    test('keeps the highest-scoring terms, not an arbitrary slice', () => {
        // Same source and recency as the strongest of the crowd, but seen across three projects —
        // which is the repetition signal, so it must come out on top.
        const built = buildDynamicTerms(
            [
                { term: 'Strongest', source: 'contact', lastEditedAt: NOW, projectId: 'p1' },
                { term: 'Strongest', source: 'contact', lastEditedAt: NOW, projectId: 'p2' },
                { term: 'Strongest', source: 'contact', lastEditedAt: NOW, projectId: 'p3' },
                ...manyCandidates,
            ],
            { now: NOW }
        )
        expect(built.terms[0]).toBe('Strongest')
    })

    test('summarizes the sources it selected from', () => {
        const built = buildDynamicTerms(
            [
                { term: 'Anna Somova', source: 'contact', lastEditedAt: NOW, projectId: 'p1' },
                { term: 'Heyflow', source: 'company', lastEditedAt: NOW, projectId: 'p1' },
            ],
            { now: NOW }
        )
        expect(built.bySource).toEqual({ contact: 1, company: 1 })
    })

    test('returns an empty list for an empty workspace without throwing', () => {
        expect(buildDynamicTerms([], { now: NOW })).toEqual({
            terms: [],
            rankedCount: 0,
            droppedCount: 0,
            bySource: {},
        })
    })
})

// `toUpperCase()` is the identity for caseless scripts, so the original shape check classified every
// CJK/Arabic/Thai word as an "acronym" and admitted all of them — silently disabling the structural
// filter for half the languages `language: 'multi'` covers.
describe('caseless scripts', () => {
    const { hasLetterCase } = require('./voiceVocabularyTerms')

    test('knows which scripts carry a case signal', () => {
        expect(hasLetterCase('Somova')).toBe(true)
        expect(hasLetterCase('Иванов')).toBe(true)
        expect(hasLetterCase('山田太郎')).toBe(false)
        expect(hasLetterCase('مشروع')).toBe(false)
        expect(hasLetterCase('ทดสอบ')).toBe(false)
    })

    test('still admits caseless names, since there is no shape signal to judge them by', () => {
        // Rejecting these would remove the feature entirely for Japanese, Arabic and Thai users.
        expect(isDistinctiveTerm('山田太郎')).toBe(true)
        expect(isDistinctiveTerm('مشروع')).toBe(true)
    })

    test('keeps rejecting lowercase words in scripts that DO have case', () => {
        // The regression this guards: an over-broad "acronym" rule would admit these too.
        expect(isDistinctiveTerm('проект')).toBe(false)
        expect(isDistinctiveTerm('somova')).toBe(false)
    })
})
