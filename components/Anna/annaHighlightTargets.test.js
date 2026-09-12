import { createHighlightTargetRegistry, resolveHighlightRects } from './annaHighlightTargets'
let root, text, bounds
const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height })
beforeEach(() => {
    bounds = rect(200, 50, 400, 300)
    root = document.createElement('div')
    root.innerHTML = '<p>Prepare project review</p><p hidden>Private hidden text</p><textarea>Unsent draft</textarea>'
    document.body.appendChild(root)
    text = root.querySelector('p').firstChild
    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => bounds)
    jest.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
        display: 'block',
        visibility: 'visible',
        opacity: '1',
        overflowX: '',
        overflowY: '',
    }))
    Range.prototype.getClientRects = jest.fn(() => [rect(220, 70, 180, 20)])
})
afterEach(() => {
    root.remove()
    jest.restoreAllMocks()
    delete Range.prototype.getClientRects
})
const accepted = registry => {
    const { targets, references } = registry(root)
    const snapshot = { id: 'screen-1' }
    const command = {
        screenId: snapshot.id,
        path: window.location.pathname,
        targetId: targets[0].id,
        quote: 'project review',
        expiresAt: Date.now() + 12000,
    }
    return { command, snapshot, references }
}
it('offers visible text only and retains identities through rerenders of the inventory', () => {
    const registry = createHighlightTargetRegistry()
    expect(registry(root).targets.map(target => target.text)).toEqual(['Prepare project review'])
    expect(registry(root).targets[0].id).toBe(registry(root).targets[0].id)
})
it('tracks changed geometry without modifying text or inserting markup', () => {
    const { command, snapshot, references } = accepted(createHighlightTargetRegistry())
    expect(resolveHighlightRects(command, snapshot, references, root)[0].top).toBe(70)
    Range.prototype.getClientRects.mockReturnValue([rect(220, 90, 180, 20)])
    expect(resolveHighlightRects(command, snapshot, references, root)[0].top).toBe(90)
    expect(text.textContent).toBe('Prepare project review')
    expect(root.querySelector('mark')).toBeNull()
})
it('rejects stale screen, edited text, navigation and expired commands', () => {
    const { command, snapshot, references } = accepted(createHighlightTargetRegistry())
    expect(resolveHighlightRects(command, { id: 'new-screen' }, references, root)).toEqual([])
    expect(resolveHighlightRects({ ...command, path: '/other' }, snapshot, references, root)).toEqual([])
    expect(resolveHighlightRects({ ...command, expiresAt: 0 }, snapshot, references, root)).toEqual([])
    text.textContent = 'Changed draft'
    expect(resolveHighlightRects(command, snapshot, references, root)).toEqual([])
})
it('clips the marker to the workspace and rejects a detached target', () => {
    const { command, snapshot, references } = accepted(createHighlightTargetRegistry())
    Range.prototype.getClientRects.mockReturnValue([rect(190, 70, 70, 20)])
    expect(resolveHighlightRects(command, snapshot, references, root)[0]).toMatchObject({ left: 200, width: 60 })
    text.remove()
    expect(resolveHighlightRects(command, snapshot, references, root)).toEqual([])
})
it('groups the existing SocialText word spans into one addressable phrase', () => {
    root.innerHTML =
        '<div data-anna-highlight-group="true"><span>Top</span><span>things</span><span>in</span><span>Milano</span></div>'
    const { targets, references } = createHighlightTargetRegistry()(root)
    expect(targets.map(target => target.text)).toEqual(['Top things in Milano'])
    const command = {
        screenId: 's1',
        path: window.location.pathname,
        targetId: targets[0].id,
        quote: 'in Milano',
        expiresAt: Date.now() + 10000,
    }
    expect(resolveHighlightRects(command, { id: 's1' }, references, root)).toHaveLength(2)
})
