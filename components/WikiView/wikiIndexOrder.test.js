import {
    compareWikiPagesByUpdatedAt,
    getWikiIndexPages,
    getWikiSearchTerms,
    sortWikiPagesByUpdatedAt,
    wikiPageMatchesSearch,
} from './wikiIndexOrder'

const page = (slug, title, updatedAt, summary = '') => ({ slug, title, summary, updatedAt })
const slugs = pages => pages.map(item => item.slug)

describe('the order of the wiki index', () => {
    it('lists the most recently updated page first', () => {
        const pages = [
            page('alt', 'Alt', Date.UTC(2026, 9, 1)),
            page('neu', 'Neu', Date.UTC(2026, 9, 25)),
            page('mitte', 'Mitte', Date.UTC(2026, 9, 12)),
        ]
        expect(slugs(sortWikiPagesByUpdatedAt(pages))).toEqual(['neu', 'mitte', 'alt'])
    })

    it('puts pages without a usable date last, whatever shape the missing date has', () => {
        const pages = [
            page('ohne', 'A ohne', null),
            page('null', 'B null', 0),
            page('kaputt', 'C kaputt', 'not a date'),
            page('datiert', 'Z datiert', Date.UTC(2020, 0, 1)),
        ]
        expect(slugs(sortWikiPagesByUpdatedAt(pages))).toEqual(['datiert', 'ohne', 'null', 'kaputt'])
    })

    it('breaks ties by title and then slug, so the order never depends on the input order', () => {
        const at = Date.UTC(2026, 9, 20)
        const pages = [page('b2', 'Beta', at), page('a', 'Alpha', at), page('b1', 'Beta', at)]
        const expected = ['a', 'b1', 'b2']
        expect(slugs(sortWikiPagesByUpdatedAt(pages))).toEqual(expected)
        expect(slugs(sortWikiPagesByUpdatedAt([...pages].reverse()))).toEqual(expected)
        expect(compareWikiPagesByUpdatedAt(pages[0], pages[0])).toBe(0)
    })

    it('reads a date stored as a string the way the index displays it', () => {
        const pages = [page('zahl', 'Zahl', 1000), page('text', 'Text', '2000')]
        expect(slugs(sortWikiPagesByUpdatedAt(pages))).toEqual(['text', 'zahl'])
    })

    it('never reorders the list it was given', () => {
        const pages = [page('alt', 'Alt', 1), page('neu', 'Neu', 2)]
        sortWikiPagesByUpdatedAt(pages)
        expect(slugs(pages)).toEqual(['alt', 'neu'])
    })
})

describe('searching the wiki index', () => {
    const kunden = page('kunden', 'Kunden', 1, 'Wer unsere Kunden sind und was sie brauchen')

    it('matches title and summary regardless of case', () => {
        expect(wikiPageMatchesSearch(kunden, 'KUNDEN')).toBe(true)
        expect(wikiPageMatchesSearch(kunden, 'brauchen')).toBe(true)
        expect(wikiPageMatchesSearch(kunden, 'preise')).toBe(false)
    })

    it('needs every word of the query, in any order', () => {
        expect(wikiPageMatchesSearch(kunden, 'brauchen kunden')).toBe(true)
        expect(wikiPageMatchesSearch(kunden, 'kunden preise')).toBe(false)
    })

    it('ignores accents and surrounding whitespace', () => {
        const ueberblick = page('ueberblick', 'Überblick', 1, 'Café und Straße')
        expect(wikiPageMatchesSearch(ueberblick, '  uberblick ')).toBe(true)
        expect(wikiPageMatchesSearch(ueberblick, 'überblick')).toBe(true)
        expect(wikiPageMatchesSearch(ueberblick, 'cafe')).toBe(true)
        expect(getWikiSearchTerms('  ')).toEqual([])
    })

    it('does not search the page body, which the index does not show', () => {
        expect(wikiPageMatchesSearch({ ...kunden, body: 'Acme GmbH' }, 'acme')).toBe(false)
    })

    it('keeps the matches newest first and shows everything for an empty query', () => {
        const pages = [page('alt', 'Kunden alt', 1), page('preise', 'Preise', 3), page('neu', 'Kunden neu', 2)]
        expect(slugs(getWikiIndexPages(pages, 'kunden'))).toEqual(['neu', 'alt'])
        expect(slugs(getWikiIndexPages(pages, ''))).toEqual(['preise', 'neu', 'alt'])
    })
})
