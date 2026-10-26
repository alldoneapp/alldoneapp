import {
    WIKI_RANGE_KIND,
    WIKI_RANGE_LAST_30_DAYS,
    WIKI_RANGE_LAST_3_CHANGES,
    WIKI_RANGE_LAST_7_DAYS,
    WIKI_RANGE_LAST_CHANGE,
    WIKI_RANGE_PRESETS,
    buildWikiRangeOptions,
    getDefaultWikiRangeBase,
    getWikiRangeRevisions,
    normalizeWikiRangeBase,
    resolveWikiRangeChange,
    resolveWikiRangePreset,
} from './wikiRecentChanges'
import { WIKI_CHANGE_CREATED } from '../../functions/KnowledgeBase/knowledgeWikiFeedModel'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 26, 12)

const revision = (number, extra = {}) => ({
    revision: number,
    title: 'Kunden',
    summary: 'Wer unsere Kunden sind',
    body: `Text ${number}`,
    sourceKeys: ['task:t1'],
    createdAt: NOW - (10 - number) * DAY,
    ...extra,
})

const preset = id => WIKI_RANGE_PRESETS.find(item => item.id === id)

describe('wiki recent changes', () => {
    it('reads a base only as a whole number from 0', () => {
        expect(normalizeWikiRangeBase('0')).toBe(0)
        expect(normalizeWikiRangeBase('7')).toBe(7)
        expect(normalizeWikiRangeBase(3)).toBe(3)
        expect(normalizeWikiRangeBase(-1)).toBeNull()
        expect(normalizeWikiRangeBase('1.5')).toBeNull()
        expect(normalizeWikiRangeBase('x')).toBeNull()
        expect(normalizeWikiRangeBase('')).toBeNull()
        expect(normalizeWikiRangeBase(null)).toBeNull()
    })

    it('opens on the last change of a page, and on its creation for a new page', () => {
        expect(getDefaultWikiRangeBase(9)).toBe(8)
        expect(getDefaultWikiRangeBase(1)).toBe(0)
        expect(getDefaultWikiRangeBase(undefined)).toBe(0)
    })

    describe('presets', () => {
        // Revisions 1..9, one a day, revision 9 a day ago.
        const revisions = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(number => revision(number))
        const context = { currentRevision: 9, revisions, now: NOW }

        it('counts changes back from the newest revision', () => {
            expect(resolveWikiRangePreset(preset(WIKI_RANGE_LAST_CHANGE), context)).toEqual({ base: 8 })
            expect(resolveWikiRangePreset(preset(WIKI_RANGE_LAST_3_CHANGES), context)).toEqual({ base: 6 })
            expect(
                resolveWikiRangePreset(preset(WIKI_RANGE_LAST_3_CHANGES), { ...context, currentRevision: 2 })
            ).toEqual({ base: 0 })
        })

        it('starts a period at the newest revision made before it', () => {
            // Revision 2 was made 8 days ago, revision 3 seven days ago (inside the period).
            expect(resolveWikiRangePreset(preset(WIKI_RANGE_LAST_7_DAYS), context)).toEqual({ base: 2 })
        })

        it('covers the whole page when every revision lies inside the period and the first is loaded', () => {
            expect(resolveWikiRangePreset(preset(WIKI_RANGE_LAST_30_DAYS), context)).toEqual({ base: 0 })
        })

        it('asks for a lookup when the period reaches past the loaded revisions', () => {
            const recent = revisions.slice(4) // revisions 5..9, all inside 30 days
            expect(resolveWikiRangePreset(preset(WIKI_RANGE_LAST_30_DAYS), { ...context, revisions: recent })).toEqual({
                lookupBefore: NOW - 30 * DAY,
            })
        })

        it('offers no period in which the page did not change', () => {
            const old = revisions.map(item => ({ ...item, createdAt: NOW - 60 * DAY + item.revision }))
            expect(resolveWikiRangePreset(preset(WIKI_RANGE_LAST_7_DAYS), { ...context, revisions: old })).toBe(null)
        })

        it('offers each comparison once, in the order of the presets', () => {
            const options = buildWikiRangeOptions(context)
            expect(options).toEqual([
                { id: WIKI_RANGE_LAST_CHANGE, base: 8 },
                { id: WIKI_RANGE_LAST_3_CHANGES, base: 6 },
                { id: WIKI_RANGE_LAST_7_DAYS, base: 2 },
                { id: WIKI_RANGE_LAST_30_DAYS, base: 0 },
            ])
            // A page with one revision: "last change" and "last 3 changes" are the same thing.
            const single = buildWikiRangeOptions({ currentRevision: 1, revisions: [revision(1)], now: NOW })
            expect(single.map(option => option.id)).toEqual([WIKI_RANGE_LAST_CHANGE])
        })

        it('offers nothing for a page without revisions', () => {
            expect(buildWikiRangeOptions({ currentRevision: 0, revisions: [], now: NOW })).toEqual([])
        })
    })

    describe('the comparison', () => {
        it('compares the base revision with the newest one', () => {
            const change = resolveWikiRangeChange(6, revision(6), revision(9, { title: 'Kunden 2026' }))
            expect(change).toMatchObject({ status: 'ok', kind: WIKI_RANGE_KIND })
            expect(change.before).toMatchObject({ title: 'Kunden', body: 'Text 6' })
            expect(change.after).toMatchObject({ title: 'Kunden 2026', body: 'Text 9' })
        })

        it('reads everything as added from before the page existed or from an archived base', () => {
            expect(resolveWikiRangeChange(0, null, revision(3))).toMatchObject({
                status: 'ok',
                kind: WIKI_CHANGE_CREATED,
                before: { body: '' },
            })
            expect(resolveWikiRangeChange(4, { revision: 4, archived: true }, revision(5)).before).toMatchObject({
                body: '',
            })
        })

        it('never pieces together a base whose text the wiki removed', () => {
            const change = resolveWikiRangeChange(6, { revision: 6, redacted: true }, revision(9))
            expect(change).toEqual({
                status: 'baseUnavailable',
                kind: WIKI_RANGE_KIND,
                before: null,
                after: expect.any(Object),
            })
            expect(resolveWikiRangeChange(6, null, revision(9)).status).toBe('baseUnavailable')
        })

        it('shows nothing of a newest revision that was redacted', () => {
            expect(resolveWikiRangeChange(6, revision(6), revision(9, { redacted: true, body: undefined }))).toEqual({
                status: 'redacted',
                kind: WIKI_RANGE_KIND,
            })
        })

        it('has nothing to compare from the newest revision on, and nothing for an archived page', () => {
            expect(resolveWikiRangeChange(9, revision(9), revision(9)).status).toBe('empty')
            expect(resolveWikiRangeChange(12, null, revision(9)).status).toBe('empty')
            expect(resolveWikiRangeChange(3, revision(3), { revision: 9, archived: true }).status).toBe('missing')
            expect(resolveWikiRangeChange(3, revision(3), null).status).toBe('missing')
        })
    })

    it('lists the single changes of a range, newest first, and counts those not loaded', () => {
        const loaded = [revision(7), revision(9), revision(8), revision(6)]
        const range = getWikiRangeRevisions(loaded, 6, 9)
        expect(range.listed.map(item => item.revision)).toEqual([9, 8, 7])
        expect(range).toMatchObject({ total: 3, notListed: 0 })
        expect(getWikiRangeRevisions(loaded, 2, 9)).toMatchObject({ total: 7, notListed: 3 })
        expect(getWikiRangeRevisions(loaded, 9, 9)).toMatchObject({ total: 0, notListed: 0 })
    })
})
