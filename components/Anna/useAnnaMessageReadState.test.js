import React, { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import useAnnaMessageReadState, { getAnnaUnreadCommentIds } from './useAnnaMessageReadState'
import { markChatCommentsAsRead } from '../../utils/backends/Chats/markChatCommentsAsRead'

jest.mock('../../utils/backends/Chats/markChatCommentsAsRead', () => ({ markChatCommentsAsRead: jest.fn() }))

const createStore = initialState => {
    let state = initialState
    const listeners = new Set()
    return {
        getState: () => state,
        dispatch: jest.fn(),
        subscribe: listener => {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
        replaceState: nextState => {
            state = nextState
            listeners.forEach(listener => listener())
        },
    }
}

const stateWithNotifications = commentIds => ({
    projectChatNotifications: {
        p1: {
            c1: {
                followedCommentIds: commentIds,
                unfollowedCommentIds: [],
            },
        },
    },
})

function Harness() {
    const scrollRef = useRef(null)
    const messages = [{ id: 'm1' }, { id: 'm2' }]
    useAnnaMessageReadState('p1', 'c1', scrollRef, messages)
    return (
        <div ref={scrollRef}>
            {messages.map(message => (
                <article key={message.id} data-anna-message-id={message.id} />
            ))}
        </div>
    )
}

describe('Anna message read state', () => {
    let container
    let root
    let store
    let observer
    let originalIntersectionObserver
    let originalVisibilityState

    beforeEach(async () => {
        global.IS_REACT_ACT_ENVIRONMENT = true
        jest.clearAllMocks()
        markChatCommentsAsRead.mockResolvedValue(undefined)
        store = createStore(stateWithNotifications(['m1', 'm2']))
        originalIntersectionObserver = global.IntersectionObserver
        originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState')
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
        global.IntersectionObserver = jest.fn((callback, options) => {
            observer = {
                callback,
                options,
                observe: jest.fn(),
                disconnect: jest.fn(),
            }
            return observer
        })
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        await act(async () => {
            root.render(
                <Provider store={store}>
                    <Harness />
                </Provider>
            )
        })
    })

    afterEach(async () => {
        await act(async () => root.unmount())
        container.remove()
        global.IntersectionObserver = originalIntersectionObserver
        if (originalVisibilityState) Object.defineProperty(document, 'visibilityState', originalVisibilityState)
        else delete document.visibilityState
        delete global.IS_REACT_ACT_ENVIRONMENT
    })

    it('deduplicates followed and unfollowed notification ids', () => {
        expect(
            getAnnaUnreadCommentIds({ followedCommentIds: ['m1', 'm2'], unfollowedCommentIds: ['m2', 'm3'] })
        ).toEqual(['m1', 'm2', 'm3'])
    })

    it('marks only unread messages that intersect the visible conversation', async () => {
        const [first, second] = [...container.querySelectorAll('article')]
        await act(async () => {
            observer.callback([
                { target: first, isIntersecting: true },
                { target: second, isIntersecting: false },
            ])
        })

        expect(markChatCommentsAsRead).toHaveBeenCalledWith([{ projectId: 'p1', chatId: 'c1', commentId: 'm1' }])
    })

    it('reconciles a notification that arrives after its message is visible', async () => {
        store = createStore(stateWithNotifications([]))
        await act(async () => {
            root.render(
                <Provider store={store}>
                    <Harness />
                </Provider>
            )
        })
        const first = container.querySelector('article')
        await act(async () => observer.callback([{ target: first, isIntersecting: true }]))
        expect(markChatCommentsAsRead).not.toHaveBeenCalled()

        await act(async () => store.replaceState(stateWithNotifications(['m1'])))

        expect(markChatCommentsAsRead).toHaveBeenCalledWith([{ projectId: 'p1', chatId: 'c1', commentId: 'm1' }])
    })

    it('keeps an intersecting message unread while Anna is in a hidden tab', async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
        const first = container.querySelector('article')
        await act(async () => observer.callback([{ target: first, isIntersecting: true }]))

        expect(markChatCommentsAsRead).not.toHaveBeenCalled()

        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
        await act(async () => document.dispatchEvent(new Event('visibilitychange')))

        expect(markChatCommentsAsRead).toHaveBeenCalledWith([{ projectId: 'p1', chatId: 'c1', commentId: 'm1' }])
    })
})
