import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import AnnaWorkspaceHighlight from './AnnaWorkspaceHighlight'
const mockUpdate = jest.fn().mockResolvedValue(undefined)
jest.mock('../../utils/backends/firestore', () => ({ getDb: () => ({ doc: () => ({ update: mockUpdate }) }) }))
jest.mock('../../i18n/TranslationService', () => ({ translate: value => value }))
let root, mount, workspace
const conversation = { id: 'anna_u1', projectId: 'p1' }
const render = async (command, active = true) =>
    act(async () =>
        root.render(
            <AnnaWorkspaceHighlight
                rootRef={{ current: workspace }}
                active={active}
                conversation={{ ...conversation, annaHighlight: command }}
                routeId={1}
            />
        )
    )
beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    jest.useFakeTimers()
    jest.clearAllMocks()
    jest.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    workspace = document.createElement('div')
    workspace.innerHTML = '<p>Prepare project review</p>'
    mount = document.createElement('div')
    document.body.append(workspace, mount)
    root = createRoot(mount)
    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
        left: 100,
        top: 100,
        right: 500,
        bottom: 500,
    })
    jest.spyOn(window, 'getComputedStyle').mockReturnValue({
        display: 'block',
        visibility: 'visible',
        opacity: '1',
        overflowX: '',
        overflowY: '',
    })
    Range.prototype.getClientRects = jest.fn(() => [{ left: 120, top: 140, right: 300, bottom: 160 }])
})
afterEach(() => {
    act(() => root.unmount())
    workspace.remove()
    mount.remove()
    jest.useRealTimers()
    jest.restoreAllMocks()
    delete Range.prototype.getClientRects
    delete global.IS_REACT_ACT_ENVIRONMENT
})
async function show() {
    await render()
    const screen = mockUpdate.mock.calls.find(([patch]) => patch.annaScreenContext)?.[0].annaScreenContext
    const command = {
        id: 'mark1',
        action: 'mark',
        screenId: screen.id,
        targetId: screen.targets[0].id,
        quote: 'project review',
        path: window.location.pathname,
        expiresAt: Date.now() + 12000,
    }
    await render(command)
    return command
}
it('acknowledges a rendered marker and lets Escape dismiss it without changing the work', async () => {
    await show()
    expect(document.querySelector('.anna-highlight-marker')).toBeTruthy()
    expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ annaHighlightStatus: expect.objectContaining({ id: 'mark1', status: 'shown' }) })
    )
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(document.querySelector('.anna-highlight-overlay')).toBeNull()
    expect(workspace.textContent).toBe('Prepare project review')
})
it('removes the highlight at expiry and when its text changes', async () => {
    const command = await show()
    await act(async () => jest.advanceTimersByTime(12000))
    expect(document.querySelector('.anna-highlight-overlay')).toBeNull()
    await render({ ...command, id: 'mark2', expiresAt: Date.now() + 12000 })
    expect(document.querySelector('.anna-highlight-overlay')).toBeTruthy()
    workspace.querySelector('p').textContent = 'Edited note'
    await act(async () => jest.advanceTimersByTime(150))
    expect(document.querySelector('.anna-highlight-overlay')).toBeNull()
})
