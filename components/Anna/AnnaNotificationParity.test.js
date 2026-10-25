import React, { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { createStore } from 'redux'
import ChatsButton from '../TopBar/ChatsButton'
import useAnnaActivityNotices from './useAnnaActivityNotices'
import useAnnaMessageReadState from './useAnnaMessageReadState'
import { markChatCommentsAsRead } from '../../utils/backends/Chats/markChatCommentsAsRead'

jest.mock('../Icon', () => () => null)
jest.mock('../Feeds/FollowSwitchableTag/AmountTag', () => ({ feedAmount, isFollowedButton }) => (
    <span data-testid="chat-badge" data-red={isFollowedButton}>
        {feedAmount}
    </span>
))
jest.mock('../../utils/HelperFunctions', () => ({ dismissAllPopups: jest.fn() }))
jest.mock('../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../../redux/store', () => ({ getState: () => ({ route: 'Root' }) }))
jest.mock('../../redux/actions', () => ({ hideFloatPopup: jest.fn(), navigateToAllProjectsChats: jest.fn() }))
// Keep the actual badge filtering, without loading unrelated backend write functions.
jest.mock('../../utils/backends/Chats/chatsComments', () => jest.requireActual('../../utils/notificationBadges'))
jest.mock('../../utils/backends/Chats/markChatCommentsAsRead', () => ({ markChatCommentsAsRead: jest.fn() }))
jest.mock('../../utils/appResume', () => ({ subscribePageVisible: () => () => {} }))

const conversation = { projectId: 'p1', id: 'anna' }
const messages = [{ id: 'reply' }]
const notifications = (projectId = 'p1', chatId = 'other', followed = true) => ({
    [projectId]: {
        totalFollowed: followed ? 1 : 0,
        totalUnfollowed: followed ? 0 : 1,
        [chatId]: {
            totalFollowed: followed ? 1 : 0,
            totalUnfollowed: followed ? 0 : 1,
            followedCommentIds: followed ? ['reply'] : [],
            unfollowedCommentIds: followed ? [] : ['reply'],
            followedNotifications: followed ? [{ commentId: 'reply', date: 1100 }] : [],
        },
    },
})

function Harness() {
    const scroll = useRef(null)
    const notices = useAnnaActivityNotices('user', conversation, true)
    useAnnaMessageReadState('p1', 'anna', scroll, messages)
    return (
        <>
            <ChatsButton color="black" />
            <div ref={scroll}>
                <article data-anna-message-id="reply" />
            </div>
            <output>{notices.map(notice => notice.id).join(',')}</output>
        </>
    )
}

let root, container, store, observe, originalObserver
const replace = changes => act(() => store.dispatch({ type: 'replace', changes }))
const settle = () => act(() => jest.advanceTimersByTime(1000))
beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    jest.useFakeTimers({ now: 1000 })
    jest.clearAllMocks()
    localStorage.clear()
    originalObserver = global.IntersectionObserver
    global.IntersectionObserver = jest.fn(callback => {
        observe = callback
        return { observe: jest.fn(), disconnect: jest.fn() }
    })
    const state = {
        loggedUser: { uid: 'user', archivedProjectIds: ['archived'], templateProjectIds: ['template'] },
        loggedUserProjects: [{ id: 'p1', name: 'Project' }],
        projectChatNotifications: {},
        activeChatData: {},
    }
    store = createStore((previous = state, action) => ({ ...previous, ...action.changes }))
    markChatCommentsAsRead.mockImplementation(async () => {
        store.dispatch({ type: 'replace', changes: { projectChatNotifications: {} } })
    })
    container = document.createElement('div')
    root = createRoot(container)
    act(() =>
        root.render(
            <Provider store={store}>
                <Harness />
            </Provider>
        )
    )
})
afterEach(() => {
    act(() => root.unmount())
    global.IntersectionObserver = originalObserver
    jest.useRealTimers()
    delete global.IS_REACT_ACT_ENVIRONMENT
})

it.each([
    ['grey', { projectChatNotifications: notifications('p1', 'other', false) }],
    ['archived', { projectChatNotifications: notifications('archived') }],
    ['template', { projectChatNotifications: notifications('template') }],
    [
        'open chat',
        {
            projectChatNotifications: notifications(),
            activeChatData: { projectId: 'p1', chatId: 'other', chatType: 'tasks' },
        },
    ],
])('does not show a notice when the real top-right badge excludes %s messages', (_, changes) => {
    replace(changes)
    settle()
    expect(container.querySelector('[data-red="true"]')).toBeNull()
    expect(container.querySelector('output').textContent).toBe('')
})

it('shows the same unread message as the red badge and retains its history after reading', () => {
    replace({ projectChatNotifications: notifications() })
    expect(container.querySelector('[data-red="true"]').textContent).toBe('1')
    settle()
    expect(container.querySelector('output').textContent).toBe('chat/p1/other/reply')
    replace({ projectChatNotifications: {} })
    expect(container.querySelector('[data-testid="chat-badge"]')).toBeNull()
    expect(container.querySelector('output').textContent).toBe('chat/p1/other/reply')
})

it('does not keep a phantom notice when the real visible-message hook immediately clears the badge', async () => {
    await act(async () => observe([{ target: container.querySelector('article'), isIntersecting: true }]))
    await act(async () =>
        store.dispatch({
            type: 'replace',
            changes: { projectChatNotifications: notifications('p1', 'anna') },
        })
    )
    expect(markChatCommentsAsRead).toHaveBeenCalledWith([{ projectId: 'p1', chatId: 'anna', commentId: 'reply' }])
    settle()
    expect(container.querySelector('[data-testid="chat-badge"]')).toBeNull()
    expect(container.querySelector('output').textContent).toBe('')
    expect(localStorage.length).toBe(0)
})
