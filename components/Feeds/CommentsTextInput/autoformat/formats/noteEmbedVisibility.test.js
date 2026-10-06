import { enableDeferredNoteEmbeds, deferNoteEmbed, cancelDeferredNoteEmbed } from './noteEmbedVisibility'

let observer
let callback
beforeEach(() => {
    global.IntersectionObserver = jest.fn(cb => {
        callback = cb
        observer = { observe: jest.fn(), unobserve: jest.fn(), disconnect: jest.fn() }
        return observer
    })
})
afterEach(() => {
    delete global.IntersectionObserver
})

it('defers offscreen tasks and releases placeholder dimensions before rendering the full row', () => {
    const release = enableDeferredNoteEmbeds('n', document.body)
    const mount = document.createElement('span')
    const render = jest.fn(() => {
        expect(mount.style.display).toBe('contents')
        expect(mount.style.width).toBe('')
        expect(mount.style.height).toBe('')
        expect(mount.hasAttribute('data-deferred-embed')).toBe(false)
    })
    expect(deferNoteEmbed(mount, render, { editorId: 'n', kind: 'task', label: 'Searchable task', width: 480 })).toBe(
        true
    )
    expect(render).not.toHaveBeenCalled()
    expect(mount.textContent).toBe('Searchable task')
    expect(mount.style.width).toBe('480px')
    callback([{ target: mount, isIntersecting: false }])
    expect(render).not.toHaveBeenCalled()
    callback([{ target: mount, isIntersecting: true }])
    expect(render).toHaveBeenCalledTimes(1)
    expect(mount.style.display).toBe('contents')
    callback([
        { target: mount, isIntersecting: false },
        { target: mount, isIntersecting: true },
    ])
    expect(render).toHaveBeenCalledTimes(1)
    release()
    expect(observer.disconnect).toHaveBeenCalled()
})
it('keeps the reserved media box after activation', () => {
    const release = enableDeferredNoteEmbeds('n', document.body)
    const mount = document.createElement('span')
    const render = jest.fn()
    deferNoteEmbed(mount, render, { editorId: 'n', kind: 'image', width: 320, height: 200 })
    const size = mount.style.cssText
    callback([{ target: mount, isIntersecting: true }])
    expect(render).toHaveBeenCalledTimes(1)
    expect(mount.style.cssText).toBe(size)
    release()
})
it('cancels a deleted blot and pending roots when the note closes', () => {
    const release = enableDeferredNoteEmbeds('n', document.body)
    const removed = document.createElement('span')
    const render = jest.fn()
    deferNoteEmbed(removed, render, { editorId: 'n' })
    cancelDeferredNoteEmbed(removed)
    callback([{ target: removed, isIntersecting: true }])
    expect(render).not.toHaveBeenCalled()
    const remaining = document.createElement('span')
    deferNoteEmbed(remaining, render, { editorId: 'n' })
    release()
    callback([{ target: remaining, isIntersecting: true }])
    expect(render).not.toHaveBeenCalled()
})
it('updates searchable placeholder titles through one note subscription and hydrates on native find', () => {
    let tasks = {}
    let emit
    const unsubscribe = jest.fn()
    const release = enableDeferredNoteEmbeds('n', document.body, {
        subscribe: cb => {
            emit = cb
            return unsubscribe
        },
        getTasks: () => tasks,
    })
    const mount = document.createElement('span')
    const render = jest.fn()
    deferNoteEmbed(mount, render, { editorId: 'n', getLabel: () => tasks.title || 'Loading task' })
    tasks = { title: 'Updated title' }
    emit()
    expect(mount.textContent).toBe('Updated title')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }))
    expect(render).toHaveBeenCalledTimes(1)
    release()
    expect(unsubscribe).toHaveBeenCalled()
})
it('keeps non-note and no-observer environments on the eager path', () => {
    expect(deferNoteEmbed(document.createElement('span'), jest.fn(), { editorId: 'comment' })).toBe(false)
    delete global.IntersectionObserver
    const release = enableDeferredNoteEmbeds('unsupported', document.body)
    expect(deferNoteEmbed(document.createElement('span'), jest.fn(), { editorId: 'unsupported' })).toBe(false)
    release()
})
