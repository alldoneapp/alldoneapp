import { loadAnnaActivityContent } from './annaActivityContent'
import { annaActivityPreview, getAnnaActivityLabel } from './annaActivityText'
import { setLanguage } from '../../i18n/TranslationService'
import { findAssistantAuthor } from '../../utils/backends/Assistants/assistantAuthorLookup'
import { FEED_TASK_PARENT_GOAL, FEED_TASK_PROJECT_CHANGED_TO } from '../Feeds/Utils/FeedsConstants'

let mockState, mockDocs
const mockGet = jest.fn(path => {
    const data = mockDocs[path]
    return data instanceof Error ? Promise.reject(data) : Promise.resolve({ data: () => data })
})
jest.mock('../../redux/store', () => ({ getState: () => mockState }))
jest.mock('../../utils/backends/firestore', () => ({ getDb: () => ({ doc: path => ({ get: () => mockGet(path) }) }) }))
jest.mock('../../utils/backends/Assistants/assistantAuthorLookup', () => ({ findAssistantAuthor: jest.fn() }))

const feed = {
    id: 'feed/p1/tasks/task1/feed1',
    kind: 'feed',
    sourceProjectId: 'p1',
    occurredAt: 1791800000000,
    source: { creatorId: 'anna', entryText: 'created task', lastChangeDate: 1791800000000, dateFormated: '12102026' },
}
beforeEach(() => {
    mockState = {
        loggedUser: { uid: 'u1', projectIds: ['p1', 'p2'] },
        globalAssistants: [{ uid: 'anna', displayName: 'Anna Alldone' }],
    }
    mockDocs = { 'projectsFeeds/p1/12102026/task1': { name: 'Daniela von Volkers Besuch erzählen' } }
    mockGet.mockClear()
    findAssistantAuthor.mockReset().mockResolvedValue(null)
    setLanguage('de')
})
afterEach(() => setLanguage('en'))

it('names the exact feed object and actor, using the stored action in the current language', async () => {
    const content = await loadAnnaActivityContent(feed, 'u1')
    expect(content).toMatchObject({ objectName: 'Daniela von Volkers Besuch erzählen', actorName: 'Anna Alldone' })
    expect(getAnnaActivityLabel({ ...feed, content })).toBe('Aufgabe erstellt: Daniela von Volkers Besuch erzählen')
    expect(mockGet.mock.calls.map(([path]) => path)).toEqual(['projectsFeeds/p1/12102026/task1'])
})

it('gives content to previously generic goal and project changes', async () => {
    mockDocs['goals/p1/items/goal1'] = { name: 'Daniela Todos / Besprechen' }
    const goal = await loadAnnaActivityContent(
        { ...feed, source: { ...feed.source, entryText: '', type: FEED_TASK_PARENT_GOAL, newParentGoalId: 'goal1' } },
        'u1'
    )
    expect(getAnnaActivityLabel({ ...feed, content: goal })).toContain('Mit Ziel verknüpft: Daniela Todos / Besprechen')
    const project = await loadAnnaActivityContent(
        {
            ...feed,
            source: {
                ...feed.source,
                entryText: '',
                type: FEED_TASK_PROJECT_CHANGED_TO,
                projectName: 'Familie',
                changeDirection: 'to',
            },
        },
        'u1'
    )
    expect(getAnnaActivityLabel({ ...feed, content: project })).toContain('Verschoben nach Projekt Familie')
})

it('reads the notified comment, not the newest comment, and resolves cross-project assistant authors', async () => {
    mockDocs['chatObjects/p1/chats/chat1'] = { title: 'Sprintplanung', type: 'tasks' }
    mockDocs['chatComments/p1/tasks/chat1/comments/message1'] = {
        creatorId: 'delegate',
        fromAssistant: true,
        commentText: '**Review fertig.** [Änderungen](https://example.org/private) sind bereit.',
    }
    findAssistantAuthor.mockResolvedValue({ displayName: 'Reviewer' })
    const content = await loadAnnaActivityContent({ id: 'chat/p1/chat1/message1', kind: 'chat' }, 'u1')
    expect(content).toMatchObject({
        objectName: 'Sprintplanung',
        actorName: 'Reviewer',
        preview: 'Review fertig. Änderungen sind bereit.',
    })
    expect(findAssistantAuthor).toHaveBeenCalledWith('delegate', ['p1', 'p2'], 'u1')
    expect(mockGet).not.toHaveBeenCalledWith('users/delegate')
    expect(mockGet.mock.calls.map(([path]) => path)).toEqual([
        'chatObjects/p1/chats/chat1',
        'chatComments/p1/tasks/chat1/comments/message1',
    ])
})

it('enriches legacy history after its unread notification is cleared', async () => {
    mockDocs['feedsStore/p1/all/feed1'] = feed.source
    const { source, ...legacy } = feed
    expect(await loadAnnaActivityContent(legacy, 'u1')).toMatchObject({
        objectName: 'Daniela von Volkers Besuch erzählen',
    })
})

it('does not fabricate previews or fail the notice on inaccessible/missing content, and retries a later read', async () => {
    mockDocs['chatObjects/p1/chats/chat1'] = new Error('permission-denied')
    const notice = { id: 'chat/p1/chat1/message1', kind: 'chat' }
    expect(await loadAnnaActivityContent(notice, 'u1')).toBeNull()
    mockDocs['chatObjects/p1/chats/chat1'] = { title: 'Recovered', type: 'topics' }
    mockDocs['chatComments/p1/topics/chat1/comments/message1'] = { commentText: 'Now readable' }
    expect(await loadAnnaActivityContent(notice, 'u1')).toMatchObject({ preview: 'Now readable' })
    mockGet.mockClear()
    expect(await loadAnnaActivityContent(feed, 'other-user')).toBeNull()
    expect(mockGet).not.toHaveBeenCalled()
})

it('uses read-only fallback feed snapshots without trying to regenerate deleted objects', async () => {
    mockDocs['projectsFeeds/p1/12102026/task1'] = new Error('missing day')
    mockDocs['feedsObjectsLastStates/p1/tasks/task1'] = { name: 'Remembered task', isDeleted: true }
    expect(await loadAnnaActivityContent(feed, 'u1')).toMatchObject({ objectName: 'Remembered task' })
})

it('keeps the task context when the linked goal is no longer readable', async () => {
    mockDocs['goals/p1/items/goal1'] = new Error('permission-denied')
    const content = await loadAnnaActivityContent(
        {
            ...feed,
            source: { ...feed.source, entryText: '', type: FEED_TASK_PARENT_GOAL, newParentGoalId: 'goal1' },
        },
        'u1'
    )
    expect(getAnnaActivityLabel({ ...feed, content })).toBe(
        'Zielverknüpfung geändert: Daniela von Volkers Besuch erzählen'
    )
})

it('does not freeze an empty preview when the notified comment has not arrived yet', async () => {
    mockDocs['chatObjects/p1/chats/chat1'] = { title: 'Sprintplanung', type: 'tasks' }
    expect(await loadAnnaActivityContent({ id: 'chat/p1/chat1/message1', kind: 'chat' }, 'u1')).toBeNull()
})

it('cleans attachments, mention metadata and markup and bounds long previews', () => {
    expect(annaActivityPreview('<b>Hello</b> @AnnaM2mVOSjAVPPKweLAlldone#uid')).toBe('Hello @Anna Alldone')
    expect(annaActivityPreview('EbDsQTD14ahtSR5https://private/fileEbDsQTD14ahtSR5report.pdfEbDsQTD14ahtSR5true')).toBe(
        'report.pdf'
    )
    expect(annaActivityPreview('x'.repeat(400))).toBe('x'.repeat(239) + '…')
})
