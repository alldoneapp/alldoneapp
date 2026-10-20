import { act, renderHook } from '@testing-library/react'
import useAnnaStreamingText from './useAnnaStreamingText'
import useAnnaChatScroll from './useAnnaChatScroll'

let mockReducedMotion = false
jest.mock('../UIComponents/Ghosts/ghostAnimation', () => ({ useReducedMotion: () => mockReducedMotion }))
let frames, time, nextId, resize, disconnect
const advance = (count = 1) => {
    for (let i = 0; i < count; i++) {
        act(() => {
            time += 16
            const pending = [...frames.values()]
            frames.clear()
            pending.forEach(callback => callback(time))
        })
    }
}
beforeEach(() => {
    frames = new Map()
    time = 0
    nextId = 0
    mockReducedMotion = false
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
        frames.set(++nextId, callback)
        return nextId
    })
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => frames.delete(id))
    disconnect = jest.fn()
    global.ResizeObserver = class {
        constructor(callback) {
            resize = callback
        }
        observe() {}
        disconnect = disconnect
    }
})
afterEach(() => {
    jest.restoreAllMocks()
    delete global.ResizeObserver
})

it('shows history immediately, paces appended snapshots and catches up to long responses within 180ms', () => {
    const { result, rerender } = renderHook(({ text }) => useAnnaStreamingText(text, true), {
        initialProps: { text: 'Existing history' },
    })
    expect(result.current).toBe('Existing history')
    const text = 'Existing history' + ' long answer'.repeat(500)
    rerender({ text })
    expect(result.current).toBe('Existing history')
    advance(2)
    expect(result.current.length).toBeGreaterThan(16)
    expect(result.current.length).toBeLessThan(text.length)
    rerender({ text: text + ' final words' })
    advance(12)
    expect(result.current).toBe(text + ' final words')
    expect(frames.size).toBe(0)
})

it('handles replacement, completion, reduced motion and cancellation without stale text or pending frames', () => {
    const { result, rerender, unmount } = renderHook(
        ({ text, enabled, reduced }) => useAnnaStreamingText(text, enabled, reduced),
        { initialProps: { text: '', enabled: true, reduced: false } }
    )
    rerender({ text: 'An answer with emoji 🧠 and text', enabled: true })
    advance(3)
    expect(result.current).not.toBe('An answer with emoji 🧠 and text')
    expect(/[\uD800-\uDBFF]$/.test(result.current)).toBe(false)
    rerender({ text: 'Replacement', enabled: true })
    expect(result.current).toBe('Replacement')
    rerender({ text: 'Replacement complete', enabled: false })
    expect(result.current).toBe('Replacement complete')
    rerender({ text: 'Replacement complete and more', enabled: true, reduced: true })
    expect(result.current).toBe('Replacement complete and more')
    expect(frames.size).toBe(0)
    rerender({ text: 'Replacement complete and more again', enabled: true, reduced: false })
    expect(frames.size).toBe(1)
    unmount()
    expect(frames.size).toBe(0)
})

function scroller() {
    const element = document.createElement('div')
    document.body.append(element)
    let height = 1000,
        viewport = 400,
        top = 0
    Object.defineProperties(element, {
        scrollHeight: { get: () => height },
        clientHeight: { get: () => viewport },
        scrollTop: {
            get: () => top,
            set: value => {
                top = Math.max(0, Math.min(height - viewport, value))
            },
        },
    })
    return {
        element,
        grow: value => {
            height = value
        },
        viewport: value => {
            viewport = value
        },
    }
}

it('follows late content and viewport resizing with one animation, without treating its own frames as user scrolling', () => {
    const node = scroller()
    const scroll = { current: node.element },
        content = { current: node.element }
    const { result, unmount } = renderHook(() => useAnnaChatScroll(scroll, content, true))
    expect(node.element.scrollTop).toBe(600)
    node.grow(1600)
    act(() => {
        resize()
        resize()
        result.current.update()
    })
    expect(frames.size).toBe(1)
    advance()
    expect(node.element.scrollTop).toBeGreaterThan(600)
    expect(node.element.scrollTop).toBeLessThan(1200)
    act(() => result.current.onScroll())
    expect(result.current.follow.current).toBe(true)
    node.grow(1800)
    advance(40)
    expect(node.element.scrollTop).toBeCloseTo(1400, 0)
    node.viewport(250)
    act(() => resize())
    advance(40)
    expect(node.element.scrollTop).toBeCloseTo(1550, 0)
    unmount()
    expect(disconnect).toHaveBeenCalled()
    expect(frames.size).toBe(0)
    node.element.remove()
})

it.each(['wheel', 'touch', 'keyboard', 'scrollbar'])(
    'hands control to the reader via %s, keeps their position on growth and can resume',
    method => {
        const node = scroller()
        const { result, unmount } = renderHook(() =>
            useAnnaChatScroll({ current: node.element }, { current: node.element }, true)
        )
        node.grow(1700)
        act(() => result.current.update())
        advance(2)
        act(() => {
            if (method === 'wheel') result.current.onWheel({ deltaY: -10 })
            if (method === 'touch') {
                result.current.onTouchStart({ touches: [{ clientY: 100 }] })
                result.current.onTouchMove({ touches: [{ clientY: 110 }] })
            }
            if (method === 'keyboard') result.current.onKeyDown({ key: 'PageUp' })
            if (method === 'scrollbar') {
                node.element.scrollTop -= 20
                result.current.onScroll()
            }
        })
        const position = node.element.scrollTop
        node.grow(2200)
        act(() => resize())
        advance(20)
        expect(node.element.scrollTop).toBe(position)
        expect(result.current.follow.current).toBe(false)
        act(() => result.current.latest())
        advance(40)
        expect(node.element.scrollTop).toBeCloseTo(1800, 0)
        // Returning to the bottom manually also re-arms the follow.
        act(() => {
            result.current.stop()
            node.element.scrollTop = 1800
            result.current.onScroll()
        })
        expect(result.current.follow.current).toBe(true)
        unmount()
        node.element.remove()
    }
)

it('respects a live reduced-motion change and does not animate a hidden mobile pane', () => {
    const node = scroller()
    const scroll = { current: node.element },
        content = { current: node.element }
    const { result, rerender, unmount } = renderHook(({ visible }) => useAnnaChatScroll(scroll, content, visible), {
        initialProps: { visible: true },
    })
    node.grow(1600)
    act(() => result.current.update())
    expect(frames.size).toBe(1)
    mockReducedMotion = true
    rerender({ visible: true })
    expect(node.element.scrollTop).toBe(1200)
    expect(frames.size).toBe(0)
    rerender({ visible: false })
    node.grow(2000)
    act(() => resize())
    expect(node.element.scrollTop).toBe(1200)
    rerender({ visible: true })
    expect(node.element.scrollTop).toBe(1600)
    unmount()
    node.element.remove()
})
