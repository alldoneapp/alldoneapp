const mockProcessUrl = jest.fn()
const mockGetChatMeta = jest.fn()

jest.mock('../../utils/NavigationService', () => ({ __esModule: true, default: { navigate: jest.fn() } }))
jest.mock('../../utils/TabNavigationConstants', () => ({ DV_TAB_PROJECT_WIKI: 'DV_TAB_PROJECT_WIKI' }))
jest.mock('../../URLSystem/URLTrigger', () => ({ __esModule: true, default: { processUrl: mockProcessUrl } }))
jest.mock('../../utils/backends/Chats/chatsFirestore', () => ({ getChatMeta: mockGetChatMeta }))
jest.mock('../../utils/LinkingHelper', () => {
    const link = (projectId, objectId, objectType, tab) =>
        `/projects/${projectId}/${objectType === 'users' ? 'contacts' : objectType}/${objectId}/${tab}`
    return {
        getDvMainTabLink: (projectId, objectId, objectType) => link(projectId, objectId, objectType, 'properties'),
        getDvChatTabLink: (projectId, objectId, objectType) => link(projectId, objectId, objectType, 'chat'),
    }
})

import { getWikiThreadPath, openWikiSource } from './wikiLinks'

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('openWikiSource', () => {
    beforeEach(() => {
        mockProcessUrl.mockClear()
        mockGetChatMeta.mockReset()
    })

    it('opens an artifact in the Artifacts tab', () => {
        expect(openWikiSource('p1', { objectType: 'artifact', id: 'a1' })).toBe(true)
        expect(mockProcessUrl).toHaveBeenCalledWith(expect.anything(), '/projects/p1/artifacts/a1')
    })

    it('opens a conversation where it is read, after looking up what kind of thread it is', async () => {
        mockGetChatMeta.mockResolvedValueOnce({ id: 't1', type: 'tasks' })
        mockGetChatMeta.mockResolvedValueOnce({ id: 'topic', type: 'topics' })

        openWikiSource('p1', { objectType: 'chat', id: 't1' })
        openWikiSource('p1', { objectType: 'chat', id: 'topic' })
        await flush()

        expect(mockGetChatMeta).toHaveBeenCalledWith('p1', 't1')
        expect(mockProcessUrl.mock.calls.map(([, path]) => path)).toEqual([
            '/projects/p1/tasks/t1/chat',
            '/projects/p1/chats/topic/chat',
        ])
    })

    it('stays put when the conversation is gone or cannot be read', async () => {
        mockGetChatMeta.mockResolvedValueOnce(null)
        mockGetChatMeta.mockRejectedValueOnce(new Error('permission-denied'))
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

        openWikiSource('p1', { objectType: 'chat', id: 'gone' })
        openWikiSource('p1', { objectType: 'chat', id: 'hidden' })
        await flush()

        expect(mockProcessUrl).not.toHaveBeenCalled()
        warn.mockRestore()
    })

    it('still opens tasks and leaves corrections and documents alone', () => {
        expect(openWikiSource('p1', { objectType: 'task', id: 't1' })).toBe(true)
        expect(openWikiSource('p1', { objectType: 'correction', id: 'k1' })).toBe(false)
        expect(openWikiSource('p1', { objectType: 'document', id: 'd1' })).toBe(false)
        expect(mockProcessUrl.mock.calls.map(([, path]) => path)).toEqual(['/projects/p1/tasks/t1/properties'])
    })
})

describe('getWikiThreadPath', () => {
    it('knows where every thread the wiki compiles is read', () => {
        expect(getWikiThreadPath('p1', 'n1', 'notes')).toBe('/projects/p1/notes/n1/chat')
        expect(getWikiThreadPath('p1', 'a1', 'artifacts')).toBe('/projects/p1/artifacts/a1/chat')
        expect(getWikiThreadPath('p1', 'x', 'skills')).toBeNull()
    })
})
