import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { isAnnaMode, resolveAnnaMode, setAnnaMode, useAnnaMode, withAnnaMode, withoutAnnaMode } from './annaMode'

beforeEach(() => window.history.replaceState(null, '', '/projects/tasks/open'))
afterEach(() => window.history.replaceState(null, '', '/'))

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
