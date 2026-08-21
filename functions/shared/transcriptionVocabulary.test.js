/**
 * Tests for the shared dictation vocabulary (PT-4648): the keyterm list handed to Deepgram, the
 * glossary block injected into the rambler cleanup prompt, and the raw-vs-cleaned observability
 * summary.
 *
 * The load-bearing contract is the "Alldone" / "all done" homophone: the acoustic layer biases
 * towards the brand, so the prompt MUST also protect the ordinary English phrase, or the fix just
 * trades one error for its mirror image.
 */

const {
    PRODUCT_KEYTERMS,
    BRAND_CONFUSABLE_FORMS,
    getTranscriptionKeyterms,
    buildVocabularyPromptSection,
    summarizeVocabularyUsage,
} = require('./transcriptionVocabulary')

describe('PRODUCT_KEYTERMS', () => {
    test('contains the brand that motivated the feature', () => {
        expect(PRODUCT_KEYTERMS).toContain('Alldone')
    })

    test('stays well under the 500-token keyterm budget Deepgram enforces', () => {
        // Deepgram rejects the request past 500 tokens across all keyterms and recommends 20-50
        // terms. A rough word count is enough to catch the list quietly growing into a liability.
        const approximateTokens = PRODUCT_KEYTERMS.join(' ').split(/\s+/).length
        expect(approximateTokens).toBeLessThan(50)
        expect(PRODUCT_KEYTERMS.length).toBeLessThanOrEqual(50)
    })

    test('holds no generic common words, which Deepgram warns dilute the prompt', () => {
        // Deepgram's guidance is explicit: generic terms cause false boosts. These are the app's own
        // domain nouns and are exactly the tempting-but-wrong additions.
        const generic = ['task', 'goal', 'note', 'assistant', 'project', 'chat', 'the', 'and', 'is']
        for (const term of PRODUCT_KEYTERMS) {
            expect(generic).not.toContain(term.toLowerCase())
        }
    })

    test('has no duplicates and no empty or untrimmed entries', () => {
        expect(new Set(PRODUCT_KEYTERMS).size).toBe(PRODUCT_KEYTERMS.length)
        for (const term of PRODUCT_KEYTERMS) {
            expect(typeof term).toBe('string')
            expect(term).toBe(term.trim())
            expect(term.length).toBeGreaterThan(0)
        }
    })

    test('carries no weight/intensifier syntax', () => {
        // `keyterm=term:0.15` is the legacy `keywords` syntax. Deepgram does NOT error on it — it
        // accepts the whole string as one literal keyterm and boosts nothing, so this would fail
        // silently in production and look like keyterm simply not working.
        for (const term of PRODUCT_KEYTERMS) {
            expect(term).not.toMatch(/:/)
            expect(term).not.toMatch(/[,;]/)
        }
    })
})

describe('getTranscriptionKeyterms', () => {
    test('returns the product vocabulary', () => {
        expect(getTranscriptionKeyterms()).toEqual(PRODUCT_KEYTERMS)
    })

    test('returns a copy, so a caller cannot mutate the module state', () => {
        const first = getTranscriptionKeyterms()
        first.push('Injected')
        expect(getTranscriptionKeyterms()).not.toContain('Injected')
        expect(PRODUCT_KEYTERMS).not.toContain('Injected')
    })
})

describe('buildVocabularyPromptSection', () => {
    const section = buildVocabularyPromptSection()

    test('lists every keyterm so the cleanup can repair what the acoustic layer missed', () => {
        for (const term of PRODUCT_KEYTERMS) {
            expect(section).toContain(term)
        }
    })

    test('protects the ordinary phrase "all done" as explicitly as it pushes the brand', () => {
        // Without this the prompt trades one error for its mirror image.
        expect(section).toContain('Alldone')
        expect(section).toContain('all done')
        expect(section.toLowerCase()).toContain('finished')
    })

    test('forbids inserting a product name into a sentence that does not call for it', () => {
        expect(section).toContain('Never insert one of these names into a sentence that does not call for it')
    })

    test('tells the model to decide from the sentence rather than the transcript spelling', () => {
        expect(section).toContain('Decide from the sentence')
    })
})

describe('summarizeVocabularyUsage', () => {
    test('separates a Deepgram hit from a cleanup repair', () => {
        // Brand already correct in the raw transcript => the keyterm prompt did the work.
        const acoustic = summarizeVocabularyUsage('Add this to Alldone please', 'Add this to Alldone.')
        expect(acoustic.terms.Alldone).toEqual({ raw: 1, cleaned: 1 })

        // Brand absent from raw but present after cleanup => the LLM did the work.
        const repaired = summarizeVocabularyUsage('Add this to all done please', 'Add this to Alldone.')
        expect(repaired.terms.Alldone).toEqual({ raw: 0, cleaned: 1 })
        expect(repaired.confusable['all done']).toEqual({ raw: 1, cleaned: 0 })
    })

    test('exposes the mirror-image error the brand boost can introduce', () => {
        // The speaker meant "finished"; the cleanup wrongly branded it. Visible as the brand
        // appearing in `cleaned` while the ordinary phrase disappears.
        const overreach = summarizeVocabularyUsage('are we all done here', 'Are we Alldone here?')
        expect(overreach.terms.Alldone).toEqual({ raw: 0, cleaned: 1 })
        expect(overreach.confusable['all done']).toEqual({ raw: 1, cleaned: 0 })
    })

    test('leaves a correct ordinary phrase untouched in both directions', () => {
        const ordinary = summarizeVocabularyUsage('we are all done here', 'We are all done here.')
        expect(ordinary.terms.Alldone).toBeUndefined()
        expect(ordinary.confusable['all done']).toEqual({ raw: 1, cleaned: 1 })
    })

    test('matches case-insensitively, so a lowercase acoustic hit still counts', () => {
        const lower = summarizeVocabularyUsage('add this to alldone', 'Add this to Alldone.')
        expect(lower.terms.Alldone).toEqual({ raw: 1, cleaned: 1 })
    })

    test('counts repeated occurrences rather than collapsing them', () => {
        const repeated = summarizeVocabularyUsage('Alldone and Alldone again', 'Alldone and Alldone again.')
        expect(repeated.terms.Alldone).toEqual({ raw: 2, cleaned: 2 })
    })

    test('omits terms absent from both texts, keeping the log line small', () => {
        const summary = summarizeVocabularyUsage('a plain sentence', 'A plain sentence.')
        expect(summary.terms).toEqual({})
        expect(summary.confusable).toEqual({})
    })

    test('never returns the dictated content itself', () => {
        // The whole point of counting: this log line is safe to leave on in production.
        const serialized = JSON.stringify(summarizeVocabularyUsage('Alldone secret payroll numbers', 'Alldone.'))
        expect(serialized).not.toContain('payroll')
        expect(serialized).not.toContain('secret')
    })

    test('tolerates missing or non-string input', () => {
        expect(summarizeVocabularyUsage(undefined, undefined)).toEqual({ terms: {}, confusable: {} })
        expect(summarizeVocabularyUsage(null, 42)).toEqual({ terms: {}, confusable: {} })
    })

    test('tracks every documented confusable brand form', () => {
        expect(BRAND_CONFUSABLE_FORMS).toContain('all done')
        for (const form of BRAND_CONFUSABLE_FORMS) {
            const summary = summarizeVocabularyUsage(`x ${form} y`, '')
            expect(summary.confusable[form].raw).toBe(1)
        }
    })
})
