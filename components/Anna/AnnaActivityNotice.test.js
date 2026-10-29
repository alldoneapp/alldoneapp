import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import AnnaActivityNotice, { AnnaActivityGroup } from './AnnaActivityNotice'
import { annaActivityHistory } from './annaActivityHistory'
import { loadAnnaActivityContent } from './annaActivityContent'
import { publishAnnaActivityContext } from './annaActivityContext'
import { setLanguage } from '../../i18n/TranslationService'

let mockState, root, container, notice
jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))
jest.mock('./annaActivityContext', () => ({ publishAnnaActivityContext: jest.fn(async () => {}) }))
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
    publishAnnaActivityContext.mockClear()
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
    // The object is the title; what happened to it is a chip (AT-2906).
    expect(container.querySelector('.anna-activity-title').textContent).toBe('Sprintplanung')
    expect(container.querySelector('.anna-activity-actions').textContent).toBe('Neue Chatnachricht')
    expect(container.querySelector('.anna-activity-preview').textContent).toBe(details.preview)
    expect(container.querySelector('.anna-activity-meta').textContent).toBe('Familie · Anna Alldone')
    // A thread whose type is not known yet opens its own chat object, never the followed chats
    // inbox (which crashed on cold projects, AT-2906).
    expect(container.querySelector('a').getAttribute('href')).toBe('/projects/p1/chats/chat1/chat')
    expect(container.querySelector('a').hasAttribute('data-anna-activity-link')).toBe(true)
    expect(publishAnnaActivityContext).toHaveBeenLastCalledWith(
        'u1',
        expect.objectContaining({
            id: notice.id,
            content: expect.objectContaining({ label: 'Neue Chatnachricht: Sprintplanung', preview: details.preview }),
        })
    )
    expect(annaActivityHistory.read('u1')[0]).toMatchObject({ created: 1000, chatId: 'anna', content: details })
    // The parent still holds the original notice when this row is remounted while offline.
    expect(notice.content).toBeUndefined()
    act(() => root.unmount())
    root = createRoot(container)
    mockState.connectionState = 'offline'
    loadAnnaActivityContent.mockClear()
    publishAnnaActivityContext.mockClear()
    await render()
    expect(container.textContent).toContain(details.preview)
    expect(loadAnnaActivityContent).not.toHaveBeenCalled()
    expect(publishAnnaActivityContext).not.toHaveBeenCalled()
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

const feedNotice = (feedId, created, entryText, objectId = 'task1') =>
    annaActivityHistory.append('u1', {
        id: `feed/p1/tasks/${objectId}/${feedId}`,
        kind: 'feed',
        sourceProjectId: 'p1',
        projectId: 'home',
        chatId: 'anna',
        created,
        path: '/projects/p1/user/u1/updates/followed',
        projectName: 'Alldone Team',
        entryText,
    })

describe('one row per object (AT-2906)', () => {
    const renderGroup = notices => act(async () => root.render(<AnnaActivityGroup notices={notices} />))
    const taskDetails = {
        version: 1,
        objectName: 'Vorstellungsgespräch üben basierend auf einer Jobanzeige',
        actorName: 'Karsten Wysk',
        preview: '',
    }

    it('shows a completion once, in the user language, even when the old English duplicate was saved', async () => {
        loadAnnaActivityContent.mockResolvedValue(taskDetails)
        await renderGroup([
            feedNotice('status', 1000, 'checked task as Done'),
            feedNotice('legacy', 1001, 'marked as complete'),
        ])
        expect(container.querySelectorAll('.anna-activity-notice')).toHaveLength(1)
        expect(container.querySelector('.anna-activity-title').textContent).toBe(taskDetails.objectName)
        expect(container.querySelector('.anna-activity-actions').textContent).toBe('Aufgabe als erledigt markiert')
        expect(container.querySelector('.anna-activity-meta').textContent).toBe('Alldone Team · Karsten Wysk')
        expect(container.querySelector('a').getAttribute('href')).toBe('/projects/p1/tasks/task1/properties')
        // Every arrival still reaches the assistant context on its own.
        expect(publishAnnaActivityContext.mock.calls.map(([, published]) => published.id)).toEqual(
            expect.arrayContaining(['feed/p1/tasks/task1/status', 'feed/p1/tasks/task1/legacy'])
        )
    })

    it('opens the chat of the object for a new message and shows links as compact chips', async () => {
        loadAnnaActivityContent.mockImplementation(async item =>
            item.kind === 'chat'
                ? {
                      ...taskDetails,
                      objectType: 'tasks',
                      preview: 'Release ist live. Deployment: https://github.com/kwkrass/alldone_team/actions/runs/42.',
                  }
                : taskDetails
        )
        const chat = annaActivityHistory.append('u1', {
            id: 'chat/p1/task1/message1',
            kind: 'chat',
            sourceProjectId: 'p1',
            projectId: 'home',
            chatId: 'anna',
            created: 1002,
            path: '/projects/p1/user/u1/chats/followed',
            projectName: 'Alldone Team',
        })
        await renderGroup([feedNotice('status', 1000, 'checked task as Done'), chat])
        expect(container.querySelector('a').getAttribute('href')).toBe('/projects/p1/tasks/task1/chat')
        expect([...container.querySelectorAll('.anna-activity-action')].map(chip => chip.textContent)).toEqual([
            'Aufgabe als erledigt markiert',
            'Neue Chatnachricht',
        ])
        const link = container.querySelector('.anna-activity-link')
        expect(link.textContent).toBe('GitHub · Actions')
        expect(link.getAttribute('title')).toBe('https://github.com/kwkrass/alldone_team/actions/runs/42')
        expect(container.querySelector('.anna-activity-preview').textContent).toBe(
            'Release ist live. Deployment: GitHub · Actions.'
        )
    })
})

describe('the project and the people come first (AT-2906)', () => {
    const renderGroup = notices => act(async () => root.render(<AnnaActivityGroup notices={notices} />))
    const firstLine = () => container.querySelector('.anna-activity-content').firstElementChild
    const lines = () => [...container.querySelector('.anna-activity-content').children].map(node => node.className)

    it('is the first line, project then name, above title, actions and preview', async () => {
        loadAnnaActivityContent.mockResolvedValue({ ...details, actorName: 'Karsten Wysk' })
        await render()
        expect(firstLine().className).toBe('anna-activity-meta')
        expect(firstLine().textContent).toBe('Familie · Karsten Wysk')
        expect(lines()).toEqual([
            'anna-activity-meta',
            'anna-activity-title',
            'anna-activity-actions',
            'anna-activity-preview',
        ])
    })

    it('is still the first line before the row is enriched, and when enrichment fails', async () => {
        loadAnnaActivityContent.mockResolvedValue(null)
        await render()
        expect(firstLine().className).toBe('anna-activity-meta')
        expect(firstLine().textContent).toBe('Familie')
        expect(lines()).toEqual(['anna-activity-meta', 'anna-activity-title'])
    })

    it('names every actor of a grouped row once, after the project', async () => {
        loadAnnaActivityContent.mockImplementation(async item => ({
            version: 1,
            objectName: 'Release',
            actorName: item.id.endsWith('/a') ? 'Karsten Wysk' : 'Anna Alldone',
            preview: '',
        }))
        await renderGroup([feedNotice('a', 1000, 'x'), feedNotice('b', 1001, 'y'), feedNotice('c', 1002, 'z')])
        expect(firstLine().textContent).toBe('Alldone Team · Karsten Wysk, Anna Alldone')
    })

    it("uses the project's current name, and never leaves the project blank", async () => {
        loadAnnaActivityContent.mockResolvedValue(details)
        mockState.loggedUserProjectsMap = { p1: { id: 'p1', index: 0, name: 'Familie (neu)' } }
        await render()
        expect(firstLine().textContent).toBe('Familie (neu) · Anna Alldone')
        act(() => root.unmount())
        root = createRoot(container)
        mockState.loggedUserProjectsMap = {}
        await act(async () => root.render(<AnnaActivityNotice notice={{ ...notice, projectName: '' }} />))
        expect(firstLine().textContent).toBe('Unbekanntes Projekt · Anna Alldone')
    })
})

describe('long action chips stay within the row (AT-2918)', () => {
    const renderGroup = notices => act(async () => root.render(<AnnaActivityGroup notices={notices} />))
    const goalName =
        'bewerbungs-helfer mit anschreiben / lebenslauf feedback etc. / get regularly new job offers and track them'

    it('keeps the full goal-link text in the chip and its title, so CSS may ellipsise it', async () => {
        loadAnnaActivityContent.mockResolvedValue({
            version: 1,
            objectName: 'Judy Job auf Story-Pattern',
            actorName: 'Anna Alldone',
            preview: '',
            actionKey: 'Anna activity linked goal',
            actionParams: { name: goalName },
        })
        await renderGroup([feedNotice('goal', 1000, 'linked goal')])
        const chip = container.querySelector('.anna-activity-action')
        expect(chip.textContent).toBe(`Mit Ziel verknüpft: ${goalName}`)
        expect(chip.getAttribute('title')).toBe(chip.textContent)
        // Still one link to the object; the chip is not a separate click target.
        expect(container.querySelectorAll('a')).toHaveLength(1)
        expect(chip.closest('a').hasAttribute('data-anna-activity-link')).toBe(true)
    })

    it('titles the action fallback before the row is enriched', async () => {
        loadAnnaActivityContent.mockResolvedValue(null)
        await render()
        const title = container.querySelector('.anna-activity-title')
        expect(title.getAttribute('title')).toBe('Neue Chatnachricht')
    })

    it('puts a preview link label in its own span so it can ellipsise', async () => {
        loadAnnaActivityContent.mockResolvedValue({
            ...details,
            preview: 'Siehe https://gitlab.com/alldonegmbh/alldone/-/merge_requests/2918',
        })
        await render()
        const label = container.querySelector('.anna-activity-link > .anna-activity-link-label')
        expect(label.textContent).toBe('GitLab · MR !2918')
    })
})
