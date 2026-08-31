/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'

import LastComment from './LastComment'
import LastUserOrAssistantCommentContainer from './LastUserOrAssistantCommentContainer'
import NoComment from '../NoComment/NoComment'

jest.mock('./LastUserOrAssistantCommentContainer', () => {
    const React = require('react')
    const { View } = require('react-native')
    return props => <View testID="last-comment-container" {...props} />
})

jest.mock('../NoComment/NoComment', () => {
    const React = require('react')
    const { View } = require('react-native')
    return props => <View testID="assistant-no-comment" {...props} />
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

    it('ignores a grey notification and shows the assistant comment fallback', () => {
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
            objectId: 'assistant-chat',
            objectType: 'topics',
        })
        expect(tree.root.findByType(LastUserOrAssistantCommentContainer).props.fromChatNotification).toBeUndefined()
    })

    it('keeps the last-comment footprint when there is no previous comment', () => {
        const assistant = { uid: 'assistant-1' }
        const tree = renderer.create(<LastComment project={project} assistant={assistant} />)

        expect(tree.root.findByType(NoComment).props).toMatchObject({
            projectId: 'project-1',
            assistant,
        })
    })
})
