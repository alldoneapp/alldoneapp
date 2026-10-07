import { findWorkspaceObject, scrollWorkspaceObject, workspaceObjectRect } from './annaWorkspaceRevealTargets'
const change = { type: 'task', projectId: 'p1', objectId: 't1' }
const bounds = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height })
let root, row, scroller
beforeEach(() => {
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
afterEach(() => root.remove())
it('finds the offscreen exact object, never a matching title in another project or a hidden row', () => {
    expect(findWorkspaceObject(root, change)).toBe(row)
    expect(findWorkspaceObject(root, { ...change, projectId: 'p2' })).toBeNull()
    expect(findWorkspaceObject(root, { ...change, objectId: 't1"] *' })).toBeNull()
    scroller.setAttribute('aria-hidden', 'true')
    expect(findWorkspaceObject(root, change)).toBeNull()
})
it('scrolls an offscreen row within Alldone and leaves an already visible row in place', () => {
    expect(scrollWorkspaceObject(row, root)).toEqual([scroller])
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 1070, behavior: 'smooth' })
    row.getBoundingClientRect = () => bounds(440, 200, 520, 60)
    scroller.scrollTo.mockClear()
    expect(scrollWorkspaceObject(row, root)).toEqual([])
    expect(scroller.scrollTo).not.toHaveBeenCalled()
})
it('honors reduced motion, and plans nested scrolling without double-counting the inner movement', () => {
    root.style.overflowY = 'auto'
    Object.defineProperties(root, { clientHeight: { value: 600 }, scrollHeight: { value: 2200 } })
    root.scrollTo = jest.fn()
    scrollWorkspaceObject(row, root, true)
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 1070, behavior: 'instant' })
    expect(root.scrollTo).not.toHaveBeenCalled()
})
it('clips the outline to the workspace viewport and rejects offscreen or unmounted targets', () => {
    expect(workspaceObjectRect(row, root)).toBeNull()
    row.getBoundingClientRect = () => bounds(380, 110, 800, 100)
    expect(workspaceObjectRect(row, root)).toEqual({ left: 403, top: 106, width: 594, height: 108 })
    row.remove()
    expect(workspaceObjectRect(row, root)).toBeNull()
})
