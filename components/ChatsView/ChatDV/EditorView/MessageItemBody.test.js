/**
 * @jest-environment jsdom
 */

import React from 'react'
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import MessageItemBody from './MessageItemBody'
import AssistantProgress from './AssistantProgress'
import StopAssistantRunButton from './StopAssistantRunButton'
import { cancelAssistantRun } from '../../../../utils/backends/Assistants/assistantRuns'
import { resetStopRequests } from './stopAssistantRunRequests'

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
jest.mock('../../../../utils/backends/Chats/markChatCommentsAsRead', () => ({
    markAlldoneChatsReadForLinkedEmails: jest.fn(),
}))
jest.mock('./VmInteractionCard', () => 'VmInteractionCard')
// Same reason as the line above: the card subscribes to redux and to a Firestore listener, and this
// suite renders without a Provider.
jest.mock('./BrowserApprovalCard', () => 'BrowserApprovalCard')
jest.mock('./messageLoadingState', () => ({
    ...jest.requireActual('./messageLoadingState'),
    isAwaitingVmInteraction: jest.fn(() => false),
}))
jest.mock('react-redux', () => ({
    useSelector: selector => selector({ loggedUser: { uid: 'user-1' } }),
}))
jest.mock('../../../../utils/backends/Assistants/assistantRuns', () => ({
    cancelAssistantRun: jest.fn(() => Promise.resolve()),
}))

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

describe('MessageItemBody list items in a narrow chat (AT-2917)', () => {
    // A wrapping column sizes its flex line to the widest unbreakable token, so a file path in a
    // list item pushed the item (and the Assistant Mode chat with it) wider than the pane.
    test.each([
        ['bullet', '- components/ChatsView/ChatDV/EditorView/MessageItemBody.js'],
        ['numbered', '1. components/ChatsView/ChatDV/EditorView/MessageItemBody.js'],
        ['checkbox', '- [ ] components/ChatsView/ChatDV/EditorView/MessageItemBody.js'],
    ])('%s content may shrink and never wraps as a flex column', (_kind, commentText) => {
        const tree = renderer.create(
            <MessageItemBody projectId="project-1" commentText={commentText} creatorData={{ isAssistant: true }} />
        )
        const content = tree.root.findAllByType(View).filter(node => StyleSheet.flatten(node.props.style)?.flex === 1)
        expect(content).toHaveLength(1)
        const style = StyleSheet.flatten(content[0].props.style)
        expect(style.flexWrap).toBeUndefined()
        expect(style.minWidth).toBe(0)
    })
})

describe('MessageItemBody loading card cancellation', () => {
    beforeEach(() => {
        resetStopRequests()
        cancelAssistantRun.mockClear()
    })

    const renderLoadingMessage = kind => {
        let tree
        act(() => {
            tree = renderer.create(
                <MessageItemBody
                    projectId="project-1"
                    objectType="tasks"
                    chat={{ id: 'task-1' }}
                    messageId="comment-1"
                    commentText="Working"
                    creatorData={{ isAssistant: true }}
                    isLoading={true}
                    assistantRun={{ kind, status: 'running', runId: 'run-1', activity: { phase: 'thinking' } }}
                />
            )
        })
        return tree
    }

    test('keeps one Stop inside the live card, outside the scrolling activity, and cancels the same run', async () => {
        const tree = renderLoadingMessage('chat')
        const card = tree.root.findByType(AssistantProgress)
        expect(tree.root.findAllByType(StopAssistantRunButton)).toHaveLength(1)
        expect(card.findAllByType(StopAssistantRunButton)).toHaveLength(1)
        expect(card.findByType(ScrollView).findAllByType(StopAssistantRunButton)).toHaveLength(0)
        const button = card.findByType(TouchableOpacity)
        expect(StyleSheet.flatten(button.props.style).minHeight).toBe(44)

        await act(async () => button.props.onPress())

        expect(cancelAssistantRun).toHaveBeenCalledTimes(1)
        expect(cancelAssistantRun).toHaveBeenCalledWith({
            projectId: 'project-1',
            objectType: 'tasks',
            objectId: 'task-1',
            commentId: 'comment-1',
            runKind: 'chat',
            runId: 'run-1',
        })
        expect(card.findByType(TouchableOpacity).props.disabled).toBe(true)
        act(() => tree.unmount())
    })

    test('retains the standalone Stop for VM messages without a live-activity card', () => {
        const tree = renderLoadingMessage('vm_job')
        expect(tree.root.findAllByType(AssistantProgress)).toHaveLength(0)
        expect(tree.root.findAllByType(StopAssistantRunButton)).toHaveLength(1)
        expect(tree.root.findByType(StopAssistantRunButton).props.variant).toBe('standalone')
        act(() => tree.unmount())
    })
})
