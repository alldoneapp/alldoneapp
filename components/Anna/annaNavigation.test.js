import { resolveAnnaLink, shouldDeferPresentation } from './annaNavigation'
import { resolveAnnaMode } from '../../utils/annaMode'

describe('Anna entry and navigation', () => {
    it('supports an explicit assistant view on each environment while keeping ordinary URLs unchanged', () => {
        expect(resolveAnnaMode({ hostname: 'my.alldone.app', search: '?anna=1' })).toBe(false)
        expect(resolveAnnaMode({ hostname: 'my.alldone.app', search: '?assistant=1' })).toBe(true)
        expect(resolveAnnaMode({ hostname: 'my.alldone.app', search: '' })).toBe(false)
        expect(resolveAnnaMode({ hostname: 'alldonestaging.web.app', search: '?assistant=1' })).toBe(true)
        expect(resolveAnnaMode({ hostname: 'anna.alldone.app', search: '' })).toBe(true)
        expect(resolveAnnaMode({ hostname: 'anna.alldone.app', search: '?assistant=0' })).toBe(false)
        expect(resolveAnnaMode({ hostname: 'anna.alldone.app.evil.test' })).toBe(false)
    })
    it('accepts legacy local preview links without overriding the URL with stored preferences', () => {
        expect(resolveAnnaMode({ hostname: 'localhost', search: '?anna=1' })).toBe(true)
        expect(resolveAnnaMode({ hostname: 'localhost', search: '' })).toBe(false)
        expect(resolveAnnaMode({ hostname: 'localhost', search: '?anna=0' })).toBe(false)
        expect(resolveAnnaMode({ hostname: 'localhost', search: '?anna=1&assistant=0' })).toBe(false)
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
