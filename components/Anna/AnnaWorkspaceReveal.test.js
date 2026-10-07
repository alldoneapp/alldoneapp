import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import AnnaWorkspaceReveal from './AnnaWorkspaceReveal'
const mockUpdate = jest.fn().mockResolvedValue(undefined)
let mockVisible, mockHidden
jest.mock('../../utils/backends/firestore', () => ({ getDb: () => ({ doc: () => ({ update: mockUpdate }) }) }))
jest.mock('../../utils/appResume', () => ({
    subscribePageVisible: callback => {
        mockVisible = callback
        return () => {
            mockVisible = null
        }
    },
    subscribePageHidden: callback => {
        mockHidden = callback
        return () => {
            mockHidden = null
        }
    },
}))
jest.mock('../../i18n/TranslationService', () => ({
    translate: (text, values) => text.replace('%{assistantName}', values.assistantName),
}))
const bounds = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height })
let root, mount, workspace, onOpen, hidden
const cue = id => ({
    id,
    type: 'task',
    objectId: 't1',
    projectId: 'p1',
    change: 'created',
    expiresAt: Date.now() + 120000,
})
const render = (changes, available = true, status = {}) =>
    act(async () =>
        root.render(
            <AnnaWorkspaceReveal
                rootRef={{ current: workspace }}
                onOpen={onOpen}
                available={available}
                assistantName="Carl"
                conversation={{
                    id: 'anna_u1',
                    projectId: 'p1',
                    annaWorkspaceChanges: changes,
                    annaWorkspaceChangeStatus: status,
                }}
            />
        )
    )
const advance = async ms => {
    for (let elapsed = 0; elapsed < ms; elapsed += 50) await act(async () => jest.advanceTimersByTime(50))
}
const addRow = () => {
    const row = document.createElement('div')
    row.dataset.annaObjectType = 'task'
    row.dataset.annaObjectId = 't1'
    row.dataset.annaProjectId = 'p1'
    row.getBoundingClientRect = () => bounds(420, 150, 560, 60)
    workspace.append(row)
    return row
}
beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    jest.useFakeTimers()
    jest.clearAllMocks()
    hidden = false
    jest.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
    mount = document.createElement('div')
    workspace = document.createElement('div')
    workspace.getBoundingClientRect = () => bounds(400, 60, 600, 600)
    document.body.append(mount, workspace)
    root = createRoot(mount)
    onOpen = jest.fn().mockResolvedValue(undefined)
})
afterEach(() => {
    act(() => root.unmount())
    workspace.remove()
    mount.remove()
    jest.useRealTimers()
    jest.restoreAllMocks()
    delete global.IS_REACT_ACT_ENVIRONMENT
})
it('waits for the saved object to mount before confirming, then fades out without taking focus', async () => {
    await render([cue('one')])
    expect(document.querySelector('.anna-reveal-ring')).toBeNull()
    expect(mockUpdate).not.toHaveBeenCalled()
    const input = document.createElement('input')
    mount.append(input)
    input.focus()
    addRow()
    await advance(150)
    expect(document.querySelector('.anna-reveal-label').textContent).toBe('✓Created by Carl')
    expect(document.activeElement).toBe(input)
    expect(mockUpdate).toHaveBeenCalledWith({
        'annaWorkspaceChangeStatus.one': expect.objectContaining({ status: 'shown' }),
    })
    await advance(3700)
    expect(document.querySelector('.anna-reveal-ring')).toBeNull()
})
it('defers navigation during direct user editing or on the hidden mobile workspace and cancels when the user intervenes', async () => {
    addRow()
    const changes = [cue('one')]
    await render(changes, false)
    expect(onOpen).not.toHaveBeenCalled()
    await render(changes)
    expect(document.querySelector('.anna-reveal-ring')).toBeTruthy()
    await render(changes, false)
    expect(document.querySelector('.anna-reveal-ring')).toBeNull()
    expect(mockUpdate).toHaveBeenCalledWith({
        'annaWorkspaceChangeStatus.one': expect.objectContaining({ status: 'dismissed' }),
    })
    await render(changes)
    expect(onOpen).toHaveBeenCalledTimes(1)
})
it('serializes multiple saved results without restarting the first animation on a snapshot', async () => {
    addRow()
    const changes = [cue('one')]
    await render(changes)
    await render([...changes, cue('two')])
    expect(onOpen).toHaveBeenCalledTimes(1)
    await advance(3850)
    expect(onOpen).toHaveBeenCalledTimes(2)
    expect(mockUpdate).toHaveBeenCalledWith({
        'annaWorkspaceChangeStatus.two': expect.objectContaining({ status: 'shown' }),
    })
})
it('does not replay acknowledged or expired results after a reload', async () => {
    addRow()
    await render([{ ...cue('old'), expiresAt: Date.now() - 1 }, cue('seen')], true, { seen: { status: 'shown' } })
    expect(onOpen).not.toHaveBeenCalled()
})
it('reports missing targets honestly and continues to the next cue', async () => {
    await render([cue('missing')])
    await advance(7100)
    expect(mockUpdate).toHaveBeenCalledWith({
        'annaWorkspaceChangeStatus.missing': expect.objectContaining({ status: 'target_not_visible' }),
    })
    expect(document.querySelector('.anna-reveal-ring')).toBeNull()
    addRow()
    await render([cue('next')])
    expect(document.querySelector('.anna-reveal-ring')).toBeTruthy()
})
it('uses the shared page lifecycle to defer hidden-tab navigation and remove a running highlight', async () => {
    addRow()
    hidden = true
    await render([cue('one')])
    expect(onOpen).not.toHaveBeenCalled()
    hidden = false
    await act(async () => {
        mockVisible()
    })
    expect(onOpen).toHaveBeenCalledTimes(1)
    hidden = true
    act(() => mockHidden())
    expect(document.querySelector('.anna-reveal-ring')).toBeNull()
    await advance(100)
    hidden = false
    await act(async () => {
        mockVisible()
    })
    expect(onOpen).toHaveBeenCalledTimes(1)
})
