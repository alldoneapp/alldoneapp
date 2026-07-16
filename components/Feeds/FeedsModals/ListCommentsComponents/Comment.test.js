/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet } from 'react-native'
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
    parseFeedComment: text => [{ type: 'text', text }],
    TEXT_ELEMENT: 'text',
    HASH_ELEMENT: 'hash',
    URL_ELEMENT: 'url',
    MENTION_ELEMENT: 'mention',
    EMAIL_ELEMENT: 'email',
}))
jest.mock('../../../Tags/HashTag', () => 'HashTag')
jest.mock('../../../Tags/LinkTag', () => 'LinkTag')
jest.mock('../../../Tags/MentionTag', () => 'MentionTag')
jest.mock('../../../Tags/EmailTag', () => 'EmailTag')
jest.mock('../../../TaskListView/Utils/TasksHelper', () => ({
    getDataFromMention: jest.fn(),
}))
jest.mock('../../../Tags/GmailTag', () => 'GmailTag')
jest.mock('../../../TaskListView/EmailLine/EmailTaskAction', () => 'EmailTaskAction')

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
})
