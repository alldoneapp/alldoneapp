/**
 * @jest-environment jsdom
 */

import {
    cleanWebShareTargetParamsFromCurrentUrl,
    clearStoredWebShareTarget,
    loadPendingWebShareTarget,
    parseWebShareTarget,
} from './webShareTarget'

const makeStorage = () => {
    const values = new Map()
    return {
        getItem: key => values.get(key) || null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
    }
}

describe('Web Share Target task drafts', () => {
    test('uses the explicit shared URL instead of the page title or surrounding text', () => {
        const search = new URLSearchParams({
            share_title: 'Interesting page',
            share_text: 'Read this later',
            share_url: 'https://example.com/article?part=1',
        }).toString()

        expect(parseWebShareTarget(`?${search}`).taskName).toBe('https://example.com/article?part=1')
    })

    test('extracts a URL from Android shared text when the url field is empty', () => {
        const search = new URLSearchParams({
            share_title: 'Interesting page',
            share_text: 'Interesting page\nhttps://example.com/from-android',
        }).toString()

        expect(parseWebShareTarget(`?${search}`).taskName).toBe('https://example.com/from-android')
    })

    test('falls back to shared text when no web URL is present', () => {
        expect(parseWebShareTarget('?share_text=Remember+to+call')).toMatchObject({
            taskName: 'Remember to call',
        })
    })

    test('ignores ordinary All Projects query parameters', () => {
        expect(parseWebShareTarget('?utm_source=pwa')).toBeNull()
    })

    test('persists an incoming share through a reload and clears it after consumption', () => {
        const storage = makeStorage()
        const captured = loadPendingWebShareTarget('?share_text=https%3A%2F%2Fexample.com%2Freload', storage)

        expect(loadPendingWebShareTarget('', storage)).toEqual(captured)

        clearStoredWebShareTarget(storage)
        expect(loadPendingWebShareTarget('', storage)).toBeNull()
    })

    test('removes only share parameters from browser history', () => {
        window.history.replaceState(
            { keep: true },
            '',
            '/projects/tasks/open?share_text=https%3A%2F%2Fexample.com&utm_source=test#today'
        )

        cleanWebShareTargetParamsFromCurrentUrl()

        expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
            '/projects/tasks/open?utm_source=test#today'
        )
        expect(window.history.state).toEqual({ keep: true })
    })
})
