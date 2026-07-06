const { parseListUnsubscribe, chunk } = require('./emailLineShared')

describe('emailLineShared', () => {
    test('parseListUnsubscribe extracts https and mailto', () => {
        expect(parseListUnsubscribe('<https://ex.com/u?id=1>, <mailto:unsub@ex.com?subject=unsub>')).toEqual({
            httpsUrl: 'https://ex.com/u?id=1',
            mailto: 'mailto:unsub@ex.com?subject=unsub',
        })
    })

    test('parseListUnsubscribe handles https-only', () => {
        expect(parseListUnsubscribe('<https://ex.com/u>')).toEqual({ httpsUrl: 'https://ex.com/u' })
    })

    test('parseListUnsubscribe handles mailto-only', () => {
        expect(parseListUnsubscribe('<mailto:u@ex.com>')).toEqual({ mailto: 'mailto:u@ex.com' })
    })

    test('parseListUnsubscribe returns null for empty or non-http schemes', () => {
        expect(parseListUnsubscribe('')).toBeNull()
        expect(parseListUnsubscribe(null)).toBeNull()
        expect(parseListUnsubscribe('<ftp://ex.com>')).toBeNull()
    })

    test('parseListUnsubscribe tolerates missing angle brackets', () => {
        expect(parseListUnsubscribe('https://ex.com/u')).toEqual({ httpsUrl: 'https://ex.com/u' })
    })

    test('chunk splits into fixed sizes', () => {
        expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
        expect(chunk([], 3)).toEqual([])
    })
})
