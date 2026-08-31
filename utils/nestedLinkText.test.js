import { handleNestedLinks, toReadableUrlText } from './nestedLinkText'

// AT-2470. `handleNestedLinks` used to replace every URL-looking word in an object
// title with the literal string `LINK`, which is what a task chip then displayed.
//
// These tests drive the REAL `getUrlTokenParts` / `REGEX_URL` from
// `components/Feeds/Utils/linkDetection` on purpose. The looseness of that regex IS the
// bug: several suites in this repo stub `REGEX_URL` with `/(?:)/` or
// `/^https?:\/\/\S+$/i`, and under either stub the false positives below are
// unreproducible.

describe('handleNestedLinks (AT-2470)', () => {
    describe('never emits the literal LINK placeholder', () => {
        const titles = [
            'Update package.json',
            'Review https://gitlab.com/alldone/app/-/merge_requests/42',
            'Ship README.md and www.example.com',
        ]

        it.each(titles)('%s', title => {
            expect(handleNestedLinks(title)).not.toMatch(/\bLINK\b/)
        })
    })

    describe('leaves ordinary dotted words byte-identical', () => {
        // Every one of these matched the old `REGEX_URL.test(word)` and was rendered as
        // `LINK`. They carry no scheme and no `www.`, so they are never rewritten now.
        const untouched = [
            'Update package.json',
            'Fix Node.js build',
            'Rewrite README.md',
            'Run deploy.sh on staging',
            'Check tsconfig.json',
            'Call Dr.Smith tomorrow',
            'Meet at St.Pauli',
            // German prose with no space after the full stop.
            'Fertig.Bitte pruefen',
        ]

        it.each(untouched)('%s', title => {
            expect(handleNestedLinks(title)).toBe(title)
        })

        it('keeps a genuine bare domain, which is already the readable form', () => {
            expect(handleNestedLinks('Evaluate crew.ai for agents')).toBe('Evaluate crew.ai for agents')
        })
    })

    describe('rewrites a real URL to its readable path', () => {
        it('drops the scheme but keeps the full path', () => {
            expect(handleNestedLinks('Review https://gitlab.com/alldone/app/-/merge_requests/42')).toBe(
                'Review gitlab.com/alldone/app/-/merge_requests/42'
            )
        })

        it('drops a leading www.', () => {
            expect(handleNestedLinks('See www.example.com/docs/setup')).toBe('See example.com/docs/setup')
        })

        it('keeps the query string and the hash, which distinguish two links to one host', () => {
            expect(handleNestedLinks('Open https://app.example.com/board?filter=open#row-7')).toBe(
                'Open app.example.com/board?filter=open#row-7'
            )
        })

        it('preserves the casing of the path', () => {
            // A `new URL()`-based implementation would lowercase the host and could not
            // be trusted with the rest of the title either.
            expect(handleNestedLinks('Open https://Example.com/Path/To/Doc')).toBe('Open Example.com/Path/To/Doc')
        })

        it('rewrites several URLs in one title', () => {
            expect(handleNestedLinks('Compare https://a.com/one and https://b.com/two')).toBe(
                'Compare a.com/one and b.com/two'
            )
        })
    })

    describe('preserves the text around a URL', () => {
        it('keeps wrapping brackets and trailing punctuation', () => {
            expect(handleNestedLinks('Spec (https://example.com/spec).')).toBe('Spec (example.com/spec).')
        })

        it('keeps repeated whitespace', () => {
            expect(handleNestedLinks('a  b')).toBe('a  b')
        })

        it('trims the result, as the previous implementation did', () => {
            expect(handleNestedLinks('  padded title  ')).toBe('padded title')
        })

        it('detects a URL that follows a newline', () => {
            expect(handleNestedLinks('Title\nhttps://example.com/deep/path')).toBe('Title\nexample.com/deep/path')
        })
    })

    describe('is safe on the values the URL blot actually passes', () => {
        // `autoformat/formats/url.js` resolves its label asynchronously and can hand us
        // `undefined`; `undefined.split(' ')` used to throw inside a Backend callback.
        it.each([
            ['undefined', undefined],
            ['null', null],
        ])('returns an empty string for %s instead of throwing', (_label, value) => {
            expect(() => handleNestedLinks(value)).not.toThrow()
            expect(handleNestedLinks(value)).toBe('')
        })

        it('returns an empty string for an empty title', () => {
            expect(handleNestedLinks('')).toBe('')
        })
    })
})

describe('toReadableUrlText', () => {
    it.each([
        ['https://www.gitlab.com/group/repo/-/merge_requests/42/', 'gitlab.com/group/repo/-/merge_requests/42'],
        ['http://example.com/', 'example.com'],
        ['ftp://files.example.com/pub', 'files.example.com/pub'],
        ['www.example.com', 'example.com'],
    ])('%s -> %s', (url, expected) => {
        expect(toReadableUrlText(url)).toBe(expected)
    })

    it('never returns an empty label', () => {
        expect(toReadableUrlText('https://')).toBe('https://')
    })
})
