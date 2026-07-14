/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'

import LastComment from './LastComment'
import LastUserOrAssistantCommentContainer from './LastUserOrAssistantCommentContainer'

jest.mock('./LastUserOrAssistantCommentContainer', () => {
    const React = require('react')
    const { View } = require('react-native')
    return props => <View testID="last-comment-container" {...props} />
})

describe('LastComment', () => {
    const project = { id: 'project-1' }
    const assistantComment = { objectId: 'assistant-chat', objectType: 'topics' }

    it('keeps a followed notification marked as new', () => {
        const tree = renderer.create(
            <LastComment
                project={project}
                currentProjectChatLastNotification={{
                    chatId: 'red-chat',
                    chatType: 'topics',
                    followed: true,
                }}
                currentLastAssistantCommentData={assistantComment}
            />
        )

        expect(tree.root.findByType(LastUserOrAssistantCommentContainer).props).toMatchObject({
            objectId: 'red-chat',
            fromChatNotification: true,
            isFollowedNotification: true,
        })
    })

    it('shows a grey notification without marking it as red/new', () => {
        const tree = renderer.create(
            <LastComment
                project={project}
                currentProjectChatLastNotification={{
                    chatId: 'grey-chat',
                    chatType: 'topics',
                    followed: false,
                }}
                currentLastAssistantCommentData={assistantComment}
            />
        )

        expect(tree.root.findByType(LastUserOrAssistantCommentContainer).props).toMatchObject({
            objectId: 'grey-chat',
            fromChatNotification: true,
            isFollowedNotification: false,
        })
    })
})
