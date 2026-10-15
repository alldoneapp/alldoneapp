import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import {
    isAnnaMode,
    resolveAnnaMode,
    resolveAnnaLayout,
    restoreAnnaLayout,
    setAnnaLayout,
    setAnnaMode,
    useAnnaMode,
    withAnnaMode,
    withoutAnnaMode,
} from './annaMode'

beforeEach(() => {
    window.localStorage.clear()
    window.history.replaceState(null, '', '/projects/tasks/open')
})
afterEach(() => {
    window.localStorage.clear()
    window.history.replaceState(null, '', '/')
})

it('preserves chat-only mode through navigation and reload without changing the resource URL', () => {
    setAnnaLayout('chat')
    expect(isAnnaMode()).toBe(true)
    expect(resolveAnnaLayout(new URL(window.location.href))).toBe('chat')
    const target = withAnnaMode('/projects/p1/notes/n1/editor?newComment=1#draft')
    expect(new URL(target).searchParams.get('assistant')).toBe('chat')
    expect(withoutAnnaMode(target)).toBe(`${window.location.origin}/projects/p1/notes/n1/editor?newComment=1#draft`)
    window.history.replaceState(null, '', target)
    expect(resolveAnnaLayout(window.location)).toBe('chat')
    setAnnaMode(false)
    expect(resolveAnnaLayout(window.location)).toBe('alldone')
    setAnnaMode(true)
    expect(resolveAnnaLayout(window.location)).toBe('split')
})

it('writes the layout without changing the route, other parameters, fragment or history state', () => {
    window.history.replaceState({ task: 't1' }, '', '/projects/p1/tasks/t1/chat?filter=mine#comment')
    const length = window.history.length
    setAnnaMode(true)
    expect(window.location.pathname).toBe('/projects/p1/tasks/t1/chat')
    expect(window.location.search).toBe('?filter=mine&assistant=1')
    expect(window.location.hash).toBe('#comment')
    expect(window.history.state).toEqual({ task: 't1' })
    expect(window.history.length).toBe(length)
    expect(resolveAnnaMode(new URL(window.location.href))).toBe(true)
    setAnnaMode(false)
    expect(window.location.search).toBe('?filter=mine')
    expect(resolveAnnaMode(new URL(window.location.href))).toBe(false)
})

it('carries the selected layout to new workspace URLs and reads it afresh after navigation', () => {
    setAnnaMode(true)
    window.history.pushState({ note: 'n1' }, '', withAnnaMode('/projects/p1/notes/n1/editor?newComment=1'))
    expect(window.location.search).toBe('?newComment=1&assistant=1')
    expect(isAnnaMode()).toBe(true)
    window.history.replaceState(null, '', '/projects/goals')
    expect(isAnnaMode()).toBe(false)
    expect(withAnnaMode('/projects/tasks/open')).toBe(`${window.location.origin}/projects/tasks/open`)
    expect(withAnnaMode('https://example.org/path')).toBe('https://example.org/path')
})

it('updates mounted consumers when browser history restores a different view', () => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    const root = createRoot(container)
    const View = () => <span>{useAnnaMode() ? 'assistant' : 'fullscreen'}</span>
    try {
        act(() => root.render(<View />))
        expect(container.textContent).toBe('fullscreen')
        act(() => setAnnaMode(true))
        expect(container.textContent).toBe('assistant')
        act(() => {
            window.history.replaceState(null, '', '/projects/tasks/open')
            window.dispatchEvent(new PopStateEvent('popstate'))
        })
        expect(container.textContent).toBe('fullscreen')
    } finally {
        act(() => root.unmount())
        delete global.IS_REACT_ACT_ENVIRONMENT
    }
})

it('removes only layout parameters before matching a resource route', () => {
    expect(withoutAnnaMode('/projects/p1/tasks/t1/chat?assistant=1')).toBe('/projects/p1/tasks/t1/chat')
    expect(withoutAnnaMode('/projects/p1/notes/n1/editor?assistant=1&newComment=1#comment')).toBe(
        '/projects/p1/notes/n1/editor?newComment=1#comment'
    )
    expect(withoutAnnaMode('/projects/tasks/open?anna=1')).toBe('/projects/tasks/open')
    expect(withoutAnnaMode('/projects/tasks/open#?assistant=1')).toBe('/projects/tasks/open#?assistant=1')
})

describe.each(['desktop', 'mobile'])('%s launch layout', device => {
    const originalMatchMedia = window.matchMedia
    const preferenceKey = 'anna-mobile-layout:v1'

    beforeEach(() => {
        window.localStorage.clear()
        window.matchMedia = () => ({ matches: device === 'mobile' })
    })
    afterEach(() => {
        jest.restoreAllMocks()
        window.localStorage.clear()
        delete window.Capacitor
        if (originalMatchMedia) window.matchMedia = originalMatchMedia
        else delete window.matchMedia
    })

    it.each(['split', 'chat', 'alldone'])('restores %s from device storage in a new app instance', layout => {
        // The mode is saved immediately, even if the process is killed next.
        setAnnaLayout(layout)
        expect(window.localStorage.getItem(preferenceKey)).toBe(layout)

        window.history.replaceState({ launch: true }, '', '/?utm_source=twa#resume')
        jest.isolateModules(() => require('./annaMode').restoreAnnaLayout())

        expect(resolveAnnaLayout(window.location)).toBe(layout)
        expect(window.location.pathname).toBe('/')
        expect(new URLSearchParams(window.location.search).get('utm_source')).toBe('twa')
        expect(window.location.hash).toBe('#resume')
        expect(window.history.state).toEqual({ launch: true })
    })

    it('remembers closing the chat rather than restoring an older open preference', () => {
        setAnnaMode(true)
        setAnnaMode(false)
        window.history.replaceState(null, '', '/')
        restoreAnnaLayout()
        expect(isAnnaMode()).toBe(false)
        expect(window.localStorage.getItem(preferenceKey)).toBe('alldone')
    })

    it.each(['1', '0', 'chat'])('honors an explicit assistant=%s launch and remembers its choice', setting => {
        window.localStorage.setItem(preferenceKey, 'split')
        window.history.replaceState(null, '', `/?assistant=${setting}`)
        const expected = resolveAnnaLayout(window.location)
        restoreAnnaLayout()
        expect(window.location.search).toBe(`?assistant=${setting}`)
        expect(window.localStorage.getItem(preferenceKey)).toBe(expected)
    })

    it.each([
        '/projects/p1/notes/n1/editor?newComment=1',
        '/projects/tasks/open?share_text=Shared+task',
        '/meet/karsten',
        '/app-auth',
    ])('preserves incoming resource or special-purpose links: %s', path => {
        window.localStorage.setItem(preferenceKey, 'chat')
        window.history.replaceState(null, '', path)
        restoreAnnaLayout()
        expect(window.location.pathname + window.location.search).toBe(path)
        expect(isAnnaMode()).toBe(false)
        expect(window.localStorage.getItem(preferenceKey)).toBe('chat')
    })

    it('uses the ordinary launch view for a missing or invalid saved preference', () => {
        window.history.replaceState(null, '', '/')
        restoreAnnaLayout()
        expect(isAnnaMode()).toBe(false)
        window.localStorage.setItem(preferenceKey, 'invalid')
        restoreAnnaLayout()
        expect(isAnnaMode()).toBe(false)
        expect(window.location.search).toBe('')
    })

    it('restores the native iOS shell on a wide screen too', () => {
        window.matchMedia = () => ({ matches: false })
        window.Capacitor = { isNativePlatform: () => true }
        setAnnaMode(true)
        window.history.replaceState(null, '', '/index.html')
        restoreAnnaLayout()
        expect(isAnnaMode()).toBe(true)
    })

    it('remembers Android mode in landscape without relying on the compact breakpoint', () => {
        window.matchMedia = () => ({ matches: false })
        jest.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 16)')
        setAnnaMode(true)
        window.history.replaceState(null, '', '/?utm_source=twa')
        restoreAnnaLayout()
        expect(isAnnaMode()).toBe(true)
    })

    it('restores on desktop without depending on screen width or installed-app detection', () => {
        window.matchMedia = () => ({ matches: false })
        window.localStorage.setItem(preferenceKey, 'chat')
        window.history.replaceState(null, '', '/')
        restoreAnnaLayout()
        expect(resolveAnnaLayout(window.location)).toBe('chat')
        setAnnaMode(true)
        expect(window.localStorage.getItem(preferenceKey)).toBe('split')
    })

    it('does not overwrite a saved layout during repeated startup initialization', () => {
        window.localStorage.setItem(preferenceKey, 'chat')
        window.history.replaceState(null, '', '/?utm_source=web_app_manifest')
        const writes = jest.spyOn(Storage.prototype, 'setItem')
        restoreAnnaLayout()
        restoreAnnaLayout()
        expect(resolveAnnaLayout(window.location)).toBe('chat')
        expect(writes.mock.calls.filter(([key]) => key === preferenceKey)).toEqual([
            [preferenceKey, 'chat'],
            [preferenceKey, 'chat'],
        ])
    })

    it('keeps the saved layout through responsive changes', () => {
        setAnnaLayout('split')
        window.matchMedia = () => ({ matches: device !== 'mobile' })
        window.dispatchEvent(new Event('resize'))
        window.history.replaceState(null, '', '/index.html')
        restoreAnnaLayout()
        expect(resolveAnnaLayout(window.location)).toBe('split')
        expect(window.localStorage.getItem(preferenceKey)).toBe('split')
    })

    it('continues to launch and switch views when device storage is blocked', () => {
        jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('Storage blocked')
        })
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('Storage blocked')
        })
        window.history.replaceState(null, '', '/')
        expect(() => restoreAnnaLayout()).not.toThrow()
        expect(() => setAnnaMode(true)).not.toThrow()
        expect(isAnnaMode()).toBe(true)
        expect(() => setAnnaMode(false)).not.toThrow()
        expect(isAnnaMode()).toBe(false)
    })

    it('remembers a layout restored by browser history while the app is mounted', () => {
        global.IS_REACT_ACT_ENVIRONMENT = true
        const container = document.createElement('div')
        const root = createRoot(container)
        const View = () => <span>{useAnnaMode() ? 'assistant' : 'fullscreen'}</span>
        try {
            act(() => root.render(<View />))
            act(() => setAnnaMode(true))
            act(() => {
                window.history.replaceState(null, '', '/projects/tasks/open')
                window.dispatchEvent(new PopStateEvent('popstate'))
            })
            expect(container.textContent).toBe('fullscreen')
            expect(window.localStorage.getItem(preferenceKey)).toBe('alldone')
            window.history.replaceState(null, '', '/')
            restoreAnnaLayout()
            expect(isAnnaMode()).toBe(false)
        } finally {
            act(() => root.unmount())
            delete global.IS_REACT_ACT_ENVIRONMENT
        }
    })
})
