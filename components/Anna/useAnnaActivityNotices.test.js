import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import useAnnaActivityNotices from './useAnnaActivityNotices'

let mockState, root, container, notices, now
jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))
const conversation = { projectId: 'p1', id: 'anna' }
function Probe({ userId = 'u1', enabled = true, current = conversation }) {
    notices = useAnnaActivityNotices(userId, current, enabled)
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
    mockState.followedFeedsAmount = feeds.length ? 1 : 0
    mockState.followedFeedsData = { p1: feeds }
    render()
}
beforeEach(() => {
    jest.useFakeTimers({ now: 1000 })
    localStorage.clear()
    global.IS_REACT_ACT_ENVIRONMENT = true
    now = jest.spyOn(Date, 'now').mockReturnValue(1000)
    mockState = {
        loggedUser: { uid: 'u1', archivedProjectIds: ['archived'], templateProjectIds: ['template'] },
        loggedUserProjects: ['p1', 'archived', 'template'].map(id => ({ id, name: id })),
        followedFeedsAmount: 0,
        followedFeedsData: {},
        projectChatNotifications: {},
    }
    container = document.createElement('div')
    root = createRoot(container)
})
afterEach(() => {
    act(() => root.unmount())
    now.mockRestore()
    jest.useRealTimers()
})

it('does not retain a chat notification cleared by automatic read handling before the badge settles', () => {
    render()
    mockState.projectChatNotifications = {
        p1: {
            totalFollowed: 1,
            anna: { totalFollowed: 1, followedNotifications: [{ commentId: 'visible-reply', date: 2000 }] },
        },
    }
    render()
    // An already-visible assistant reply is immediately acknowledged by useAnnaMessageReadState.
    mockState.projectChatNotifications = {}
    render()
    act(() => jest.advanceTimersByTime(1000))
    expect(notices).toEqual([])
    expect(localStorage.length).toBe(0)
})

it('rechecks the exact message, not just whether some other chat keeps the badge red', () => {
    render()
    const chat = id => ({ totalFollowed: 1, followedNotifications: [{ commentId: id, date: 2000 }] })
    mockState.projectChatNotifications = {
        p1: { totalFollowed: 2, anna: chat('visible-reply'), other: chat('unread-reply') },
    }
    render()
    mockState.projectChatNotifications = { p1: { totalFollowed: 1, other: chat('unread-reply') } }
    render()
    act(() => jest.advanceTimersByTime(1000))
    expect(notices.map(notice => notice.id)).toEqual(['chat/p1/other/unread-reply'])
    // Once a genuine arrival was shown, reading it must still preserve its history.
    mockState.projectChatNotifications = {}
    render()
    expect(notices.map(notice => notice.id)).toEqual(['chat/p1/other/unread-reply'])
})

it.each(['open chat', 'archived project', 'disabled', 'account switch', 'unmount'])(
    'cancels an unconfirmed notice after %s',
    change => {
        render()
        mockState.projectChatNotifications = {
            p1: {
                totalFollowed: 1,
                totalUnfollowed: 0,
                other: {
                    totalFollowed: 1,
                    totalUnfollowed: 0,
                    followedNotifications: [{ commentId: 'new', date: 2000 }],
                },
            },
        }
        render()
        if (change === 'open chat') {
            mockState.activeChatData = { projectId: 'p1', chatId: 'other', chatType: 'tasks' }
            render()
        } else if (change === 'archived project') {
            mockState.loggedUser = { ...mockState.loggedUser, archivedProjectIds: ['p1'] }
            render()
        } else if (change === 'disabled') render({ enabled: false })
        else if (change === 'account switch') render({ userId: 'u2' })
        else {
            act(() => root.unmount())
            root = createRoot(container)
        }
        act(() => jest.advanceTimersByTime(1000))
        expect(notices).toEqual([])
        expect(localStorage.length).toBe(0)
    }
)

it('does not postpone an earlier unread message when newer messages arrive', () => {
    render()
    const update = ids => {
        mockState.projectChatNotifications = {
            p1: {
                totalFollowed: ids.length,
                other: {
                    totalFollowed: ids.length,
                    followedNotifications: ids.map(commentId => ({ commentId, date: 2000 })),
                },
            },
        }
        render()
    }
    update(['first'])
    act(() => jest.advanceTimersByTime(200))
    update(['first', 'second'])
    act(() => jest.advanceTimersByTime(100))
    expect(notices.map(notice => notice.id)).toEqual(['chat/p1/other/first'])
    act(() => jest.advanceTimersByTime(200))
    expect(notices.map(notice => notice.id)).toEqual(['chat/p1/other/first', 'chat/p1/other/second'])
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
            p1: {
                totalFollowed: 1,
                totalUnfollowed: 0,
                task1: { totalFollowed: 1, followedNotifications: [{ commentId, date: 2000 }] },
            },
        }
        render()
        act(() => jest.advanceTimersByTime(300))
    }
    setChat('message1')
    setChat('message2')
    expect(notices.map(notice => notice.id)).toEqual(['chat/p1/task1/message1', 'chat/p1/task1/message2'])
})

it('uses the same red chat eligibility as the badge, including active chat and hidden projects', () => {
    render()
    const chat = { totalFollowed: 1, totalUnfollowed: 0, followedNotifications: [{ commentId: 'message', date: 2000 }] }
    mockState.activeChatData = { projectId: 'p1', chatId: 'active', chatType: 'tasks' }
    mockState.projectChatNotifications = {
        p1: {
            totalFollowed: 1,
            totalUnfollowed: 1,
            active: chat,
            grey: { totalFollowed: 0, unfollowedNotifications: [{ commentId: 'grey', date: 2000 }] },
        },
        archived: { totalFollowed: 1, one: chat },
        template: { totalFollowed: 1, one: chat },
    }
    render()
    expect(notices).toEqual([])
})

it('does not turn stale payloads into notices while the corresponding red count is zero', () => {
    render()
    mockState.followedFeedsData = { p1: [feed('stale')] }
    mockState.projectChatNotifications = {
        p1: {
            totalFollowed: 0,
            totalUnfollowed: 1,
            task1: { totalFollowed: 1, followedNotifications: [{ commentId: 'stale', date: 2000 }] },
        },
    }
    render()
    expect(notices).toEqual([])
    mockState.followedFeedsAmount = 1
    mockState.projectChatNotifications.p1.totalFollowed = 1
    mockState.projectChatNotifications = { ...mockState.projectChatNotifications }
    render()
    act(() => jest.advanceTimersByTime(300))
    expect(notices).toHaveLength(2)
    mockState.followedFeedsAmount = 0
    mockState.projectChatNotifications = {}
    render()
    expect(notices).toHaveLength(2)
})

it('includes red-counted notifications without applying a second, different thread or creator filter', () => {
    render()
    mockState.projectChatNotifications = {
        p1: {
            totalFollowed: 1,
            anna: { totalFollowed: 1, followedNotifications: [{ commentId: 'reply', date: 2000 }] },
        },
    }
    addFeeds([feed('own-but-counted', 2000, { creatorId: 'u1' })])
    act(() => jest.advanceTimersByTime(300))
    expect(notices).toHaveLength(2)
})

it('does not replay updates received in Alldone-only mode', () => {
    render()
    render({ enabled: false })
    mockState.followedFeedsAmount = 1
    mockState.followedFeedsData = { p1: [feed('while-closed')] }
    render({ enabled: false })
    render()
    expect(notices).toEqual([])
    addFeeds([feed('while-closed'), feed('after-reopening')])
    expect(notices.map(notice => notice.id)).toEqual(['feed/p1/tasks/task1/after-reopening'])
})

it('isolates history by account and restores it when returning to the original account', () => {
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
    expect(notices.map(notice => notice.id)).toEqual(['feed/p1/tasks/task1/new'])
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

it('keeps earlier notices beyond the previous 100-entry limit', () => {
    render()
    addFeeds(Array.from({ length: 130 }, (_, i) => feed(`feed${i}`, 2000 + i)))
    expect(notices).toHaveLength(130)
    expect(notices[0].id).toBe('feed/p1/tasks/task1/feed0')
})

it('keeps notices after marking read, closing/reopening, and remounting with an empty inbox', () => {
    render()
    now.mockReturnValue(2500)
    addFeeds([feed('saved')])
    const { source, ...original } = notices[0]
    addFeeds([])
    render({ enabled: false })
    expect(notices).toEqual([{ ...original, source }])
    act(() => root.unmount())
    root = createRoot(container)
    render()
    expect(notices).toEqual([original])
    addFeeds([feed('saved', 3000)])
    expect(notices).toEqual([original])
})
