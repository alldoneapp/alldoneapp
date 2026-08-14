import { getShortExternalUrlText } from '../../components/Tags/linkTextUtils'

describe('linkTextUtils', () => {
    it('should shorten a URL with path', () => {
        expect(getShortExternalUrlText('example.com/some/really/long/path', 40)).toBe('example.com...')
    })

    it('should shorten a URL with query params', () => {
        expect(getShortExternalUrlText('example.com?utm_source=test&utm_medium=email', 40)).toBe('example.com...')
    })

    it('should shorten a URL with hash', () => {
        expect(getShortExternalUrlText('example.com#very-long-fragment', 40)).toBe('example.com...')
    })

    it('should keep short domain-only URL unchanged', () => {
        expect(getShortExternalUrlText('example.com', 40)).toBe('example.com')
    })

    it('should shorten long domain-only URL by text limit', () => {
        expect(getShortExternalUrlText('averyveryverylongdomainexample.com', 10)).toBe(
            'averyveryverylongdomainexample.com...'
        )
    })
})
