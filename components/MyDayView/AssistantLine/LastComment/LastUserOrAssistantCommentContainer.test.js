/**
 * @jest-environment jsdom
 */

import React from 'react'
import { View, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import LastUserOrAssistantCommentContainer, {
    DEFERRED_LAST_COMMENT_REFRESH_MS,
} from './LastUserOrAssistantCommentContainer'
import LastAssistantCommentWrapper from './LastAssistantCommentWrapper'
import { watchChat } from '../../../../utils/backends/Chats/chatsFirestore'
import { watchComments } from '../../../../utils/backends/Chats/chatsComments'
import { readLastCommentCache, writeLastCommentCache } from '../assistantLineCache'

const mockState = {
    loggedUser: { uid: 'user-1' },
    defaultAssistant: { uid: 'assistant-default' },
    projectChatNotifications: {},
    smallScreenNavigation: true,
}

jest.mock('../../../../utils/connectionState', () => ({ isBrowserOffline: () => false }))
jest.mock('../../../../utils/connectionHealth', () => ({ isManualOfflineMode: () => false }))
jest.mock('../../../../utils/backends/firestoreDirectRead', () => ({
    readDocumentDirectlyFromServer: jest.fn(() => new Promise(() => {})),
    readLatestCommentDirectlyFromServer: jest.fn(() => new Promise(() => {})),
}))
jest.mock('../../../../i18n/TranslationService', () => ({ translate: text => text }))

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))

jest.mock('../../../../utils/backends/Chats/chatsFirestore', () => ({
    watchChat: jest.fn(),
}))

jest.mock('../../../../utils/backends/Chats/chatsComments', () => ({
    watchComments: jest.fn(),
}))

jest.mock('../../../../utils/backends/firestore', () => ({
    unwatch: jest.fn(),
}))

jest.mock('./LastAssistantCommentWrapper', () => {
    const React = require('react')
    const { View } = require('react-native')
    return props => <View testID="last-assistant-comment" {...props} />
})

jest.mock('../AssistantLineSkeleton', () => {
    const React = require('react')
    const { View } = require('react-native')
    return {
        LastCommentPreviewSkeleton: props => <View testID="assistant-last-comment-loading-skeleton" {...props} />,
    }
})

describe('LastUserOrAssistantCommentContainer', () => {
    const project = { id: 'project-1', assistantId: 'assistant-project' }
    const previewContext = {
        userId: 'user-1',
        projectId: 'project-1',
        objectType: 'topics',
        objectId: 'chat-1',
    }

    beforeEach(() => {
        jest.clearAllMocks()
        localStorage.clear()
    })

    it('shows the previous preview immediately while both listeners refresh it', async () => {
        jest.useFakeTimers()
        writeLastCommentCache(previewContext, {
            commentText: 'Previously loaded comment',
            chat: { title: 'Previously loaded topic', assistantId: 'assistant-cached' },
        })

        let tree
        try {
            await act(async () => {
                tree = renderer.create(
                    <LastUserOrAssistantCommentContainer
                        project={project}
                        objectId="chat-1"
                        objectType="topics"
                        setAModalIsOpen={jest.fn()}
                    />
                )
            })

            expect(tree.root.findByType(LastAssistantCommentWrapper).props).toMatchObject({
                objectName: 'Previously loaded topic',
                assistantId: 'assistant-cached',
                commentText: 'Previously loaded comment',
            })
            expect(watchComments).not.toHaveBeenCalled()
            expect(watchChat).not.toHaveBeenCalled()

            await act(async () => {
                jest.advanceTimersByTime(DEFERRED_LAST_COMMENT_REFRESH_MS)
            })
            expect(watchComments).toHaveBeenCalledTimes(1)
            expect(watchChat).toHaveBeenCalledTimes(1)
        } finally {
            await act(async () => tree?.unmount())
            jest.useRealTimers()
        }
    })

    it('reserves the final preview height until an uncached comment arrives', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(
                <LastUserOrAssistantCommentContainer
                    project={project}
                    objectId="chat-1"
                    objectType="topics"
                    setAModalIsOpen={jest.fn()}
                />
            )
        })

        expect(tree.root.findByProps({ testID: 'assistant-last-comment-loading-skeleton' })).toBeTruthy()
        act(() => tree.unmount())
    })
})

it('replaces the endless skeleton with an accessible retry action', async () => {
    jest.useFakeTimers()
    let tree
    try {
        await act(async () => {
            tree = renderer.create(
                <LastUserOrAssistantCommentContainer
                    project={{ id: 'project-1' }}
                    objectId="chat-1"
                    objectType="topics"
                />
            )
        })
        await act(async () => jest.advanceTimersByTime(6000))
        expect(tree.root.findByProps({ testID: 'assistant-last-comment-unavailable' })).toBeTruthy()
        const retry = tree.root.findByType(TouchableOpacity)
        expect(retry.props.accessibilityRole).toBe('button')
        await act(async () => retry.props.onPress())
        expect(tree.root.findByProps({ testID: 'assistant-last-comment-loading-skeleton' })).toBeTruthy()
    } finally {
        act(() => tree?.unmount())
        jest.useRealTimers()
    }
})

describe('an unread comment below a newer read one (AT-2923)', () => {
    const project = { id: 'project-1', assistantId: 'assistant-project' }
    const previewContext = { userId: 'user-1', projectId: 'project-1', objectType: 'topics', objectId: 'chat-1' }
    const chat = { title: 'Topic', assistantId: 'assistant-1' }
    const comments = [
        { id: 'my-reply', commentText: 'My newer reply', created: 300 },
        { id: 'read-answer', commentText: 'Answer already read', created: 200 },
        { id: 'unread-answer', commentText: 'Unread answer', created: 100 },
    ]
    const unreadNotifications = {
        followedCommentIds: ['unread-answer'],
        unfollowedCommentIds: [],
        followedNotifications: [{ commentId: 'unread-answer', date: 100 }],
        unfollowedNotifications: [],
    }

    const render = async () => {
        let tree
        await act(async () => {
            tree = renderer.create(
                <LastUserOrAssistantCommentContainer
                    project={project}
                    objectId="chat-1"
                    objectType="topics"
                    setAModalIsOpen={jest.fn()}
                    fromChatNotification={true}
                    isFollowedNotification={true}
                />
            )
        })
        await act(async () => {
            watchChat.mock.calls.at(-1)[3](chat, { fromCache: false })
            watchComments.mock.calls.at(-1)[5](comments, { fromCache: false })
        })
        return tree
    }

    beforeEach(() => {
        jest.clearAllMocks()
        localStorage.clear()
        mockState.projectChatNotifications = { 'project-1': { 'chat-1': unreadNotifications } }
    })

    afterEach(() => {
        mockState.projectChatNotifications = {}
    })

    it('previews and counts the unread comment instead of the newest read one', async () => {
        const tree = await render()
        try {
            // One unread marker, so the window reaches past the read comments stacked above it.
            expect(watchComments.mock.calls.at(-1)[4]).toBe(21)
            expect(tree.root.findByType(LastAssistantCommentWrapper).props).toMatchObject({
                commentText: 'Unread answer',
                unreadComments: 1,
                isNew: true,
            })
            // The next load paints the same comment first, so the refresh is not mistaken for an arrival.
            expect(readLastCommentCache(previewContext).commentText).toBe('Unread answer')
        } finally {
            await act(async () => tree.unmount())
        }
    })

    it('falls back to the newest comment once the unread one has been read elsewhere', async () => {
        const tree = await render()
        try {
            mockState.projectChatNotifications = { 'project-1': { 'chat-1': {} } }
            await act(async () =>
                tree.update(
                    <LastUserOrAssistantCommentContainer
                        project={project}
                        objectId="chat-1"
                        objectType="topics"
                        setAModalIsOpen={jest.fn()}
                        fromChatNotification={true}
                        isFollowedNotification={true}
                    />
                )
            )
            expect(tree.root.findByType(LastAssistantCommentWrapper).props).toMatchObject({
                commentText: 'My newer reply',
                unreadComments: 0,
            })
            expect(readLastCommentCache(previewContext).commentText).toBe('My newer reply')
        } finally {
            await act(async () => tree.unmount())
        }
    })

    it('watches only the newest comment when nothing is unread', async () => {
        mockState.projectChatNotifications = {}
        const tree = await render()
        try {
            expect(watchComments.mock.calls.at(-1)[4]).toBe(1)
            expect(tree.root.findByType(LastAssistantCommentWrapper).props.commentText).toBe('My newer reply')
        } finally {
            await act(async () => tree.unmount())
        }
    })
})
