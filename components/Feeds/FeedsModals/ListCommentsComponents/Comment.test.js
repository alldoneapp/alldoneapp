/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet, Text } from 'react-native'
import renderer from 'react-test-renderer'

import Comment from './Comment'

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: value => value,
}))

jest.mock('react-redux', () => ({
    useSelector: selector => selector({ smallScreenNavigation: false }),
}))

jest.mock('../../../ContactsView/Utils/useGetUserPresentationData', () => () => ({
    photoURL: 'avatar.png',
    displayName: 'Ada',
}))

jest.mock('../../TextParser/CommentElementsParser', () => 'CommentElementsParser')
jest.mock('../../../ChatsView/ChatDV/EditorView/quoteParserFunctions', () => ({
    divideQuotedText: text => [{ type: 'text', text }],
}))
jest.mock('../../../ChatsView/ChatDV/EditorView/QuotedText', () => 'QuotedText')
jest.mock('../../../ChatsView/ChatDV/EditorView/CodeText', () => 'CodeText')
jest.mock('../../../ChatsView/ChatDV/EditorView/codeParserFunctions', () => ({
    divideCodeText: text => [{ type: 'text', text }],
}))
jest.mock('../../../ChatsView/ChatDV/EditorView/markdownParserFunctions', () => ({
    getMarkdownTableColumnWidths: jest.fn(),
    parseMarkdownLines: text => [{ type: 'text', text }],
    parseInlineFormatting: text => [{ text }],
}))
jest.mock('../../../ChatsView/Utils/ChatHelper', () => ({
    getTimestampInMilliseconds: value => value,
}))
jest.mock('../../../Icon', () => 'Icon')
jest.mock('../../Utils/HelperFunctions', () => ({
    parseFeedComment: text =>
        text
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map(value =>
                value === 'attachment-token'
                    ? { type: 'attachment', text: value }
                    : value.startsWith('https://')
                      ? { type: 'url', link: value }
                      : { type: 'text', text: value }
            ),
    TEXT_ELEMENT: 'text',
    HASH_ELEMENT: 'hash',
    URL_ELEMENT: 'url',
    MENTION_ELEMENT: 'mention',
    EMAIL_ELEMENT: 'email',
}))
jest.mock('../../../Tags/HashTag', () => 'HashTag')
jest.mock('../../../Tags/LinkTag', () => {
    const React = require('react')
    const { Text } = require('react-native')

    return props => React.createElement(Text, { ...props, testID: 'rendered-link' }, props.link.replace('https://', ''))
})
jest.mock('../../../Tags/MentionTag', () => 'MentionTag')
jest.mock('../../../Tags/EmailTag', () => 'EmailTag')
jest.mock('../../../TaskListView/Utils/TasksHelper', () => ({
    getDataFromMention: jest.fn(),
}))
jest.mock('../../../Tags/GmailTag', () => 'GmailTag')
jest.mock('../../../TaskListView/EmailLine/EmailTaskAction', () => 'EmailTaskAction')

const getRenderedText = node =>
    node.children.map(child => (typeof child === 'string' ? child : getRenderedText(child))).join('')

describe('feed Comment', () => {
    const defaultProps = {
        projectId: 'project-1',
        comment: {
            commentText: 'Informational email summary',
            lastChangeDate: 1,
            creatorId: 'user-1',
        },
        linkedEmail: {
            connectionProjectId: 'connection-1',
            messageId: 'message-1',
        },
        linkedEmailGmailData: {},
        canArchiveLinkedEmail: false,
    }

    test('places a new email badge at the right of the comment header', () => {
        const tree = renderer.create(<Comment {...defaultProps} linkedEmailNew />)
        const header = tree.root.findByProps({ testID: 'feed-comment-header' })
        const badge = header.findByProps({ testID: 'email-new-badge' })
        const actions = tree.root.findByProps({ testID: 'linked-email-actions' })

        expect(StyleSheet.flatten(badge.props.style)).toEqual(
            expect.objectContaining({
                marginLeft: 'auto',
            })
        )
        expect(actions.findAllByProps({ testID: 'email-new-badge' })).toHaveLength(0)
    })

    test('does not render the badge for other comments', () => {
        const tree = renderer.create(<Comment {...defaultProps} linkedEmailNew={false} />)

        expect(tree.root.findAllByProps({ testID: 'email-new-badge' })).toHaveLength(0)
    })

    test('renders wrapped prose with real selectable spaces instead of word-level flex margins', () => {
        const commentText =
            'This is a long prose comment that can wrap across several visual lines while remaining one natural text selection.'
        const tree = renderer.create(
            <Comment
                {...defaultProps}
                comment={{
                    ...defaultProps.comment,
                    commentText,
                }}
            />
        )
        const inlineText = tree.root.findByProps({ testID: 'comment-inline-text' })

        expect(inlineText.findAllByType('CommentElementsParser')).toHaveLength(0)
        expect(getRenderedText(inlineText)).toBe(commentText)
    })

    test('keeps links inline with semantic whitespace on both sides', () => {
        const tree = renderer.create(
            <Comment
                {...defaultProps}
                comment={{
                    ...defaultProps.comment,
                    commentText: 'Read Britannica https://example.com and continue with the paragraph.',
                }}
            />
        )
        const inlineText = tree.root.findByProps({ testID: 'comment-inline-text' })
        const link = inlineText.findByProps({ testID: 'rendered-link' })

        expect(link.props.link).toBe('https://example.com')
        expect(getRenderedText(inlineText)).toBe('Read Britannica example.com and continue with the paragraph.')
    })

    test('keeps attachment content on the rich element renderer', () => {
        const tree = renderer.create(
            <Comment
                {...defaultProps}
                comment={{
                    ...defaultProps.comment,
                    commentText: 'attachment-token',
                }}
            />
        )

        expect(tree.root.findAllByProps({ testID: 'comment-inline-text' })).toHaveLength(0)
        expect(tree.root.findAllByType('CommentElementsParser')).toHaveLength(1)
    })

    test('can replace a live technical status with a custom progress presentation', () => {
        const tree = renderer.create(
            <Comment
                {...defaultProps}
                comment={{
                    ...defaultProps.comment,
                    commentText: 'Under the hood: internal_tool_name',
                }}
                contentOverride={<Text testID="friendly-progress">Friendly progress</Text>}
            />
        )

        expect(tree.root.findByProps({ testID: 'friendly-progress' }).props.children).toBe('Friendly progress')
        expect(tree.root.findAllByProps({ testID: 'comment-inline-text' })).toHaveLength(0)
    })
})
