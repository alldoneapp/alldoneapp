/**
 * @jest-environment jsdom
 */

import React from 'react'
import { View } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import LastUserOrAssistantCommentContainer, {
    DEFERRED_LAST_COMMENT_REFRESH_MS,
} from './LastUserOrAssistantCommentContainer'
import LastAssistantCommentWrapper from './LastAssistantCommentWrapper'
import { watchChat } from '../../../../utils/backends/Chats/chatsFirestore'
import { watchComments } from '../../../../utils/backends/Chats/chatsComments'
import { writeLastCommentCache } from '../assistantLineCache'

const mockState = {
    loggedUser: { uid: 'user-1' },
    defaultAssistant: { uid: 'assistant-default' },
    projectChatNotifications: {},
    smallScreenNavigation: true,
}

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
    })
})
