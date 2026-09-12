import { resolveAnnaLink, shouldDeferPresentation } from './annaNavigation'
import { resolveAnnaMode } from '../../utils/annaMode'

describe('Anna entry and navigation', () => {
    it('leaves the current production interface unchanged even with a preview query', () => {
        expect(resolveAnnaMode({ hostname: 'my.alldone.app', search: '?anna=1' })).toBe(false)
        expect(resolveAnnaMode({ hostname: 'anna.alldone.app', search: '' })).toBe(true)
        expect(resolveAnnaMode({ hostname: 'anna.alldone.app.evil.test' })).toBe(false)
    })
    it('keeps local preview mode through existing app navigation', () => {
        const data = new Map()
        const storage = { setItem: (key, value) => data.set(key, value), getItem: key => data.get(key) }
        expect(resolveAnnaMode({ hostname: 'localhost', search: '?anna=1' }, storage)).toBe(true)
        expect(resolveAnnaMode({ hostname: 'localhost', search: '' }, storage)).toBe(true)
        expect(resolveAnnaMode({ hostname: 'localhost', search: '?anna=0' }, storage)).toBe(false)
    })
    it('opens canonical alldone object links in the workspace', () => {
        expect(resolveAnnaLink('https://my.alldone.app/projects/p1/notes/n1/editor', 'https://anna.alldone.app')).toBe(
            '/projects/p1/notes/n1/editor'
        )
    })
    it.each([
        'https://evil.test/projects/tasks/open',
        'javascript:alert(1)',
        '//my.alldone.app.evil.test/projects/tasks/open',
        '/logout',
        '/projects/p1/tasks/t1/properties/extra',
    ])('does not intercept unsafe or unsupported link %s', href => {
        expect(resolveAnnaLink(href, 'https://anna.alldone.app')).toBeNull()
    })
    it('holds new presentations while pinned or editing', () => {
        expect(shouldDeferPresentation({ pinned: true, editing: false })).toBe(true)
        expect(shouldDeferPresentation({ pinned: false, editing: true })).toBe(true)
        expect(shouldDeferPresentation({ pinned: false, editing: false })).toBe(false)
    })
})
