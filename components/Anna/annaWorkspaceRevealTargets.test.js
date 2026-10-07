import {
    findWorkspaceObject,
    scrollWorkspaceContainer,
    scrollWorkspaceObject,
    workspaceObjectRect,
} from './annaWorkspaceRevealTargets'
const change = { type: 'task', projectId: 'p1', objectId: 't1' }
const bounds = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height })
let root, row, scroller, nativeScroll, originalScrollTo
beforeEach(() => {
    originalScrollTo = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTo')
    nativeScroll = jest.fn(function ({ top, left }) {
        this.scrollTop = top
        this.scrollLeft = left
    })
    Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, writable: true, value: nativeScroll })
    root = document.createElement('div')
    root.innerHTML =
        '<div style="overflow-y:auto"><div data-anna-object-type="task" data-anna-project-id="p1" data-anna-object-id="t1">Launch</div></div>'
    document.body.append(root)
    scroller = root.firstChild
    row = scroller.firstChild
    root.getBoundingClientRect = () => bounds(400, 60, 600, 600)
    scroller.getBoundingClientRect = () => bounds(420, 80, 560, 560)
    row.getBoundingClientRect = () => bounds(440, 1400, 520, 60)
    Object.defineProperties(scroller, { clientHeight: { value: 560 }, scrollHeight: { value: 2000 } })
    scroller.scrollTo = jest.fn()
})
afterEach(() => {
    root.remove()
    if (originalScrollTo) Object.defineProperty(Element.prototype, 'scrollTo', originalScrollTo)
    else delete Element.prototype.scrollTo
})
it('finds the offscreen exact object, never a matching title in another project or a hidden row', () => {
    expect(findWorkspaceObject(root, change)).toBe(row)
    expect(findWorkspaceObject(root, { ...change, projectId: 'p2' })).toBeNull()
    expect(findWorkspaceObject(root, { ...change, objectId: 't1"] *' })).toBeNull()
    scroller.setAttribute('aria-hidden', 'true')
    expect(findWorkspaceObject(root, change)).toBeNull()
})
it('scrolls an offscreen row within Alldone and leaves an already visible row in place', () => {
    expect(scrollWorkspaceObject(row, root)).toEqual([scroller])
    expect(nativeScroll).toHaveBeenCalledWith({ top: 1070, left: 0, behavior: 'smooth' })
    expect(nativeScroll.mock.contexts[0]).toBe(scroller)
    expect(scroller.scrollTop).toBe(1070)
    expect(scroller.scrollTo).not.toHaveBeenCalled()
    row.getBoundingClientRect = () => bounds(440, 200, 520, 60)
    nativeScroll.mockClear()
    expect(scrollWorkspaceObject(row, root)).toEqual([])
    expect(nativeScroll).not.toHaveBeenCalled()
})
it('honors reduced motion, and plans nested scrolling without double-counting the inner movement', () => {
    root.style.overflowY = 'auto'
    Object.defineProperties(root, { clientHeight: { value: 600 }, scrollHeight: { value: 2200 } })
    root.scrollTo = jest.fn()
    scrollWorkspaceObject(row, root, true)
    expect(nativeScroll).toHaveBeenCalledWith({ top: 1070, left: 0, behavior: 'instant' })
    expect(scroller.scrollTo).not.toHaveBeenCalled()
    expect(root.scrollTo).not.toHaveBeenCalled()
})
it('stops a React Native scroll at its current position without resetting the horizontal offset', () => {
    scroller.scrollLeft = 24
    scroller.scrollTop = 137
    scrollWorkspaceContainer(scroller, scroller.scrollTop, true)
    expect(nativeScroll).toHaveBeenCalledWith({ top: 137, left: 24, behavior: 'instant' })
    expect(scroller.scrollTo).not.toHaveBeenCalled()
    expect(scroller.scrollTop).toBe(137)
})
it('also supports ordinary DOM scrollers and a browser without native scrollTo', () => {
    delete scroller.scrollTo
    scrollWorkspaceContainer(scroller, 245)
    expect(scroller.scrollTop).toBe(245)
    delete Element.prototype.scrollTo
    scrollWorkspaceContainer(scroller, 380, true)
    expect(scroller.scrollTop).toBe(380)
})
it('clips the outline to the workspace viewport and rejects offscreen or unmounted targets', () => {
    expect(workspaceObjectRect(row, root)).toBeNull()
    row.getBoundingClientRect = () => bounds(380, 110, 800, 100)
    expect(workspaceObjectRect(row, root)).toEqual({ left: 403, top: 106, width: 594, height: 108 })
    row.remove()
    expect(workspaceObjectRect(row, root)).toBeNull()
})
