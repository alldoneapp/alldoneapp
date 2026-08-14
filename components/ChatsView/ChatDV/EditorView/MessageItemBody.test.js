/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet } from 'react-native'
import renderer from 'react-test-renderer'

import MessageItemBody from './MessageItemBody'

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: value => value,
}))
jest.mock('../../../Feeds/TextParser/CommentElementsParser', () => 'CommentElementsParser')
jest.mock('./quoteParserFunctions', () => ({
    divideQuotedText: text => [{ type: 'text', text }],
}))
jest.mock('./QuotedText', () => 'QuotedText')
jest.mock('./codeParserFunctions', () => ({
    divideCodeText: text => [{ type: 'text', text }],
}))
jest.mock('./CodeText', () => 'CodeText')
jest.mock('../../../Icon', () => 'Icon')
jest.mock('../../../Feeds/Utils/HelperFunctions', () => ({
    parseFeedComment: text =>
        text
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map(value => ({ type: 'text', text: value })),
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
jest.mock('../../../TaskListView/EmailLine/emailLineHelper', () => ({
    openUrlInNewTab: jest.fn(),
    resolveUnsubscribeUrl: jest.fn(),
}))
jest.mock('../../../TaskListView/EmailLine/EmailTaskAction', () => 'EmailTaskAction')
jest.mock('./VmInteractionCard', () => 'VmInteractionCard')
jest.mock('./messageLoadingState', () => ({
    isAwaitingVmInteraction: jest.fn(() => false),
}))
jest.mock('./AssistantProgress', () => 'AssistantProgress')
jest.mock('./StopAssistantRunButton', () => 'StopAssistantRunButton')

describe('MessageItemBody markdown heading spacing', () => {
    test('adds top spacing to section headings without shifting an opening heading', () => {
        const tree = renderer.create(
            <MessageItemBody
                projectId="project-1"
                commentText={'# Opening heading\nParagraph\n## After paragraph\n- List item\n### After list'}
                creatorData={{ isAssistant: true }}
            />
        )
        const headings = tree.root.findAllByProps({ testID: 'markdown-heading' })

        expect(headings).toHaveLength(3)
        expect(StyleSheet.flatten(headings[0].props.style).marginTop).toBeUndefined()
        expect(StyleSheet.flatten(headings[1].props.style).marginTop).toBe(16)
        expect(StyleSheet.flatten(headings[2].props.style).marginTop).toBe(16)
    })
})
