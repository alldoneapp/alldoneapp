import { getUrlTokenParts, splitMarkdownLinks } from './linkDetection'

describe('link detection', () => {
    describe('splitMarkdownLinks', () => {
        it('extracts only the URL from a Markdown link with a spaced label', () => {
            const text =
                '[Merge Request !49 – Add default VM agent preference](https://gitlab.com/alldonegmbh/alldone/-/merge_requests/49)'

            expect(splitMarkdownLinks(text)).toEqual([
                {
                    type: 'url',
                    value: 'https://gitlab.com/alldonegmbh/alldone/-/merge_requests/49',
                },
            ])
        })

        it('keeps prose and punctuation outside the Markdown link', () => {
            expect(splitMarkdownLinks('See [the release](https://example.com/releases/1), please.')).toEqual([
                { type: 'text', value: 'See ' },
                { type: 'url', value: 'https://example.com/releases/1' },
                { type: 'text', value: ', please.' },
            ])
        })

        it('supports balanced parentheses in a Markdown URL', () => {
            expect(splitMarkdownLinks('[Article](https://en.wikipedia.org/wiki/Link_(film)).')).toEqual([
                { type: 'url', value: 'https://en.wikipedia.org/wiki/Link_(film)' },
                { type: 'text', value: '.' },
            ])
        })
    })

    describe('getUrlTokenParts', () => {
        it('preserves a plain URL unchanged', () => {
            expect(getUrlTokenParts('https://example.com/path?q=1#result')).toEqual({
                prefix: '',
                url: 'https://example.com/path?q=1#result',
                suffix: '',
            })
        })

        it('separates sentence punctuation from a plain URL', () => {
            expect(getUrlTokenParts('https://example.com/path,')).toEqual({
                prefix: '',
                url: 'https://example.com/path',
                suffix: ',',
            })
        })

        it('separates wrappers while retaining balanced URL parentheses', () => {
            expect(getUrlTokenParts('(https://en.wikipedia.org/wiki/Link_(film)).')).toEqual({
                prefix: '(',
                url: 'https://en.wikipedia.org/wiki/Link_(film)',
                suffix: ').',
            })
        })

        it('does not accept a Markdown label combined with its URL', () => {
            expect(
                getUrlTokenParts('preference](https://gitlab.com/alldonegmbh/alldone/-/merge_requests/49)')
            ).toBeNull()
        })
    })
})
