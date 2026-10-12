import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import useAnnaActivityNotices from './useAnnaActivityNotices'

let mockState, root, container, notices, now
jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))
const conversation = { projectId: 'p1', id: 'anna' }
function Probe({ userId = 'u1', enabled = true, current = conversation }) {
    notices = useAnnaActivityNotices(userId, current, [conversation], enabled)
    return null
}
const render = props => act(() => root.render(<Probe {...props} />))
const feed = (id, lastChangeDate = 2000, extra = {}) => ({
    id,
    lastChangeDate,
    objectId: 'task1',
    objectTypes: 'tasks',
    creatorId: 'other',
    ...extra,
})
const addFeeds = feeds => {
    mockState.followedFeedsData = { p1: feeds }
    render()
}
beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    now = jest.spyOn(Date, 'now').mockReturnValue(1000)
    mockState = {
        loggedUser: { uid: 'u1', archivedProjectIds: ['archived'], templateProjectIds: ['template'] },
        loggedUserProjects: ['p1', 'archived', 'template'].map(id => ({ id, name: id })),
        followedFeedsData: {},
        projectChatNotifications: {},
    }
    container = document.createElement('div')
    root = createRoot(container)
})
afterEach(() => {
    act(() => root.unmount())
    now.mockRestore()
})

it('baselines existing unread items and delayed historical snapshots, then records new arrivals once', () => {
    addFeeds([feed('existing', 900)])
    expect(notices).toEqual([])
    addFeeds([feed('existing', 900), feed('late-old', 950)])
    expect(notices).toEqual([])
    now.mockReturnValue(2500)
    addFeeds([feed('new')])
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ kind: 'feed', created: 2500, projectId: 'p1', chatId: 'anna' })
    addFeeds([])
    addFeeds([feed('new')])
    expect(notices).toHaveLength(1)
})

it('detects each new message even when the unread total stays the same', () => {
    render()
    const setChat = commentId => {
        mockState.projectChatNotifications = {
            p1: { task1: { totalFollowed: 1, followedNotifications: [{ commentId, date: 2000 }] } },
        }
        render()
    }
    setChat('message1')
    setChat('message2')
    expect(notices.map(notice => notice.id)).toEqual(['chat/p1/task1/message1', 'chat/p1/task1/message2'])
})

it('ignores own feed entries, grey activity, hidden projects and chats already shown in Anna or active', () => {
    render()
    mockState.followedFeedsData = {
        p1: [feed('own', 2000, { creatorId: 'u1' })],
        archived: [feed('archive')],
        template: [feed('template')],
        removed: [feed('removed')],
    }
    const chat = { followedNotifications: [{ commentId: 'message', date: 2000 }] }
    mockState.activeChatData = { projectId: 'p1', chatId: 'active' }
    mockState.projectChatNotifications = {
        p1: { anna: chat, active: chat, grey: { unfollowedNotifications: [{ commentId: 'grey', date: 2000 }] } },
        archived: { one: chat },
        template: { one: chat },
        removed: { one: chat },
    }
    render()
    expect(notices).toEqual([])
})

it('does not replay updates received in Alldone-only mode', () => {
    render()
    render({ enabled: false })
    mockState.followedFeedsData = { p1: [feed('while-closed')] }
    render({ enabled: false })
    render()
    expect(notices).toEqual([])
    addFeeds([feed('while-closed'), feed('after-reopening')])
    expect(notices.map(notice => notice.id)).toEqual(['feed/p1/tasks/task1/after-reopening'])
})

it('clears notices when changing accounts, including when returning to the original account', () => {
    render()
    addFeeds([feed('new')])
    expect(notices).toHaveLength(1)
    // Redux may still contain the previous account during the handover.
    render({ userId: 'u2' })
    expect(notices).toEqual([])
    mockState.loggedUser = { uid: 'u2' }
    render({ userId: 'u2' })
    mockState.loggedUser = { uid: 'u1' }
    render()
    expect(notices).toEqual([])
})

it('retains earlier notices but associates new arrivals with the new conversation at rollover', () => {
    render()
    addFeeds([feed('today')])
    const current = { projectId: 'p1', id: 'tomorrow' }
    render({ current })
    mockState.followedFeedsData = { p1: [feed('tomorrow')] }
    render({ current })
    expect(notices.map(notice => notice.chatId)).toEqual(['anna', 'tomorrow'])
})

it('bounds the local activity history', () => {
    render()
    addFeeds(Array.from({ length: 130 }, (_, i) => feed(`feed${i}`, 2000 + i)))
    expect(notices).toHaveLength(100)
    expect(notices[0].id).toBe('feed/p1/tasks/task1/feed30')
})
