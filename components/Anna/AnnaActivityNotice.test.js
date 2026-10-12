import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import AnnaActivityNotice from './AnnaActivityNotice'
import { annaActivityHistory } from './annaActivityHistory'
import { loadAnnaActivityContent } from './annaActivityContent'
import { setLanguage } from '../../i18n/TranslationService'

let mockState, root, container, notice
jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))
jest.mock('../Icon', () => () => <i />)
jest.mock('./annaActivityContent', () => ({ loadAnnaActivityContent: jest.fn() }))
jest.mock('../../utils/connectionState', () => ({ isBrowserOffline: () => false }))
const details = {
    version: 1,
    objectName: 'Sprintplanung',
    actorName: 'Anna Alldone',
    preview: 'Review fertig. Zwei offene Punkte.',
}
const render = () => act(async () => root.render(<AnnaActivityNotice notice={notice} />))
beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    localStorage.clear()
    mockState = { loggedUser: { uid: 'u1' }, connectionState: 'online', dateFormat: 'DD.MM.YYYY' }
    notice = annaActivityHistory.append('u1', {
        id: 'chat/p1/chat1/message1',
        kind: 'chat',
        sourceProjectId: 'p1',
        projectId: 'home',
        chatId: 'anna',
        created: 1000,
        path: '/projects/p1/user/u1/chats/followed',
        projectName: 'Familie',
    })
    loadAnnaActivityContent.mockReset().mockResolvedValue(details)
    setLanguage('de')
    container = document.createElement('div')
    root = createRoot(container)
})
afterEach(() => {
    act(() => root.unmount())
    setLanguage('en')
})

it('renders a meaningful linked preview and persists it unchanged for later offline reading', async () => {
    await render()
    expect(container.querySelector('.anna-activity-title').textContent).toBe('Neue Chatnachricht: Sprintplanung')
    expect(container.querySelector('.anna-activity-preview').textContent).toBe(details.preview)
    expect(container.querySelector('.anna-activity-meta').textContent).toBe('Anna Alldone · Familie')
    expect(container.querySelector('a').getAttribute('href')).toBe(notice.path)
    expect(annaActivityHistory.read('u1')[0]).toMatchObject({ created: 1000, chatId: 'anna', content: details })
    // The parent still holds the original notice when this row is remounted while offline.
    expect(notice.content).toBeUndefined()
    act(() => root.unmount())
    root = createRoot(container)
    mockState.connectionState = 'offline'
    loadAnnaActivityContent.mockClear()
    await render()
    expect(container.textContent).toContain(details.preview)
    expect(loadAnnaActivityContent).not.toHaveBeenCalled()
})

it('keeps a useful fallback on failure and enriches on reconnect', async () => {
    loadAnnaActivityContent.mockResolvedValue(null)
    await render()
    expect(container.textContent).toContain('Neue Chatnachricht')
    expect(container.textContent).toContain('Familie')
    mockState.connectionState = 'offline'
    await render()
    loadAnnaActivityContent.mockResolvedValue(details)
    mockState.connectionState = 'online'
    await render()
    expect(container.textContent).toContain(details.preview)
})

it('ignores a late response after switching accounts', async () => {
    let finish
    loadAnnaActivityContent.mockReturnValue(
        new Promise(resolve => {
            finish = resolve
        })
    )
    await render()
    mockState.loggedUser = { uid: 'other' }
    await render()
    await act(async () => finish(details))
    expect(container.textContent).not.toContain(details.preview)
    expect(annaActivityHistory.read('u1')[0].content).toBeUndefined()
    expect(annaActivityHistory.read('other')).toEqual([])
})
