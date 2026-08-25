/**
 * @jest-environment jsdom
 */

import React from 'react'
import { ActivityIndicator, Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import ChatItemUnreadMessage from './ChatItemUnreadMessage'
import { performEmailLineAction } from '../../utils/backends/EmailLine/emailLineBackend'
import { markAlldoneChatsReadForLinkedEmails } from '../../utils/backends/Chats/markChatCommentsAsRead'
import { openUrlInNewTab } from '../TaskListView/EmailLine/emailLineHelper'

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector({ loggedUser: { uid: 'user-1' } }),
}))

jest.mock('../../i18n/TranslationService', () => ({ translate: key => key, getDeviceLanguage: () => 'en' }))

// EmailTaskAction navigates to the task it created; the routing stack is not what this suite is
// about, and importing it drags the whole backend in.
jest.mock('../../URLSystem/URLTrigger', () => ({ __esModule: true, default: { processUrl: jest.fn() } }))
jest.mock('../../utils/LinkingHelper', () => ({ getDvMainTabLink: jest.fn(() => '/link') }))

jest.mock('../ContactsView/Utils/useGetUserPresentationData', () => () => ({
    photoURL: null,
    displayName: 'Ada',
    isProjectUser: true,
    isUnknownUser: false,
    isAssistant: false,
}))

jest.mock('./Utils/ChatHelper', () => ({
    getTimestampInMilliseconds: value => value,
    parseLastEdited: () => 'now',
}))

jest.mock('../ContactsView/Utils/ContactsHelper', () => ({ navigateToUserProfile: jest.fn() }))
jest.mock('../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../../redux/actions', () => ({ setSelectedNavItem: jest.fn() }))
jest.mock('../AdminPanel/Assistants/assistantsHelper', () => ({ getAssistantProjectId: jest.fn() }))

// The message body's text pipeline is the thread's own and is covered by its own suites; this
// suite is about the email action row, so the prose is reduced to a plain text node.
jest.mock('../Feeds/TextParser/CommentElementsParser', () => () => null)
// Importing it for real pulls redux/store (and the whole settings tree) in; only the four things
// the body's text path needs are stubbed, including the two regexes codeParserFunctions execs.
jest.mock('../Feeds/Utils/HelperFunctions', () => ({
    parseFeedComment: text => [{ type: 'text', value: text }],
    TEXT_ELEMENT: 'text',
    HASH_ELEMENT: 'hash',
    URL_ELEMENT: 'url',
    MENTION_ELEMENT: 'mention',
    EMAIL_ELEMENT: 'email',
    BREAKLINE_CODE: '\n',
    REGEX_BOT_CODE: /```([\s\S]*?)```/g,
    REGEX_BOT_BOLD: /\*\*(.*?)\*\*/g,
}))
jest.mock('../TaskListView/Utils/TasksHelper', () => ({ getTaskNameWithoutMeta: text => text }))
jest.mock('../Tags/HashTag', () => () => null)
jest.mock('../Tags/LinkTag', () => () => null)
jest.mock('../Tags/MentionTag', () => () => null)
jest.mock('../Tags/EmailTag', () => () => null)
jest.mock('./ChatDV/EditorView/VmInteractionCard', () => () => null)
jest.mock('./ChatDV/EditorView/AssistantProgress', () => () => null)
jest.mock('./ChatDV/EditorView/QuotedText', () => () => null)
jest.mock('./ChatDV/EditorView/CodeText', () => () => null)
jest.mock('../../utils/backends/Assistants/assistantRuns', () => ({ cancelAssistantRun: jest.fn() }))
jest.mock('../../utils/backends/EmailLine/emailLineBackend', () => ({ performEmailLineAction: jest.fn() }))
jest.mock('../../utils/backends/Chats/markChatCommentsAsRead', () => ({
    markAlldoneChatsReadForLinkedEmails: jest.fn(),
    markChatCommentsAsReadByMessageIds: jest.fn(),
}))
jest.mock('../../utils/Gmail/gmailTaskUtils', () => ({
    getGmailTaskData: gmailData => gmailData || null,
    getGmailTaskWebUrl: gmailData => gmailData?.webUrl || '',
}))
jest.mock('../TaskListView/EmailLine/emailLineHelper', () => {
    const actual = jest.requireActual('../TaskListView/EmailLine/emailLineHelper')
    return { resolveUnsubscribeUrl: actual.resolveUnsubscribeUrl, openUrlInNewTab: jest.fn() }
})

const GMAIL_DATA = {
    messageId: 'msg-1',
    connectionId: 'email_google_ada@example.com',
    gmailEmail: 'ada@example.com',
    labelName: 'Newsletter',
    webUrl: 'https://mail.google.com/mail/u/0/#inbox/msg-1',
}

const emailMessage = (overrides = {}) => ({
    id: 'comment-1',
    creatorId: 'user-2',
    commentText: 'Your invoice is ready',
    lastChangeDate: 1000,
    gmailData: GMAIL_DATA,
    ...overrides,
})

const renderPreviewMessage = (props = {}) => {
    let tree
    act(() => {
        tree = renderer.create(
            <ChatItemUnreadMessage
                projectId="project-1"
                chat={{ id: 'chat-1', type: 'topics' }}
                objectType="topics"
                message={emailMessage()}
                serverTime={5000}
                accessGranted={true}
                isArchivingEmail={() => false}
                isArchivedEmail={() => false}
                onArchiveLinkedEmail={jest.fn()}
                {...props}
            />
        )
    })
    return tree
}

const labels = tree =>
    tree.root.findAll(node => !!node.props?.accessibilityLabel).map(node => node.props.accessibilityLabel)

const pressByLabel = (tree, label) => {
    const button = tree.root.findAll(
        node => node.type === TouchableOpacity && node.props.accessibilityLabel === label
    )[0]
    act(() => button.props.onPress())
    return button
}

describe('ChatItemUnreadMessage email actions', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        // EmailTaskAction looks up an already-existing task on mount, exactly as it does in the
        // thread, so every render here makes that call.
        performEmailLineAction.mockResolvedValue({})
    })

    it('renders the same email action row the thread shows', () => {
        const tree = renderPreviewMessage()
        const rendered = labels(tree)

        // The Gmail chip, the create-task button, Archive - i.e. everything MessageItemBody
        // renders for a linked email inside the thread.
        expect(rendered).toEqual(expect.arrayContaining(['Create task', 'Archive email']))
        expect(tree.root.findAllByType(require('../Tags/GmailTag').default)).toHaveLength(1)
    })

    it('makes the message preview itself clickable without replacing its nested actions', () => {
        const onPress = jest.fn()
        const tree = renderPreviewMessage({ onPress })

        pressByLabel(tree, 'Open chat')

        expect(onPress).toHaveBeenCalledTimes(1)
        expect(labels(tree)).toEqual(expect.arrayContaining(['Open chat', 'Create task', 'Archive email']))
    })

    it('shows no email actions for an ordinary chat message', () => {
        const tree = renderPreviewMessage({ message: emailMessage({ gmailData: undefined }) })

        expect(labels(tree)).not.toEqual(expect.arrayContaining(['Archive email']))
    })

    it('hides the email actions from a viewer who is not a project member', () => {
        // Same gate as the thread: `canArchiveLinkedEmail` is the membership check, so a
        // read-only viewer previews the content without controls that would fail server-side.
        const tree = renderPreviewMessage({ accessGranted: false })

        expect(labels(tree)).not.toEqual(expect.arrayContaining(['Archive email', 'Create task']))
    })

    it('archives the previewed email through the shared handler', () => {
        const onArchiveLinkedEmail = jest.fn()
        const tree = renderPreviewMessage({ onArchiveLinkedEmail })

        pressByLabel(tree, 'Archive email')

        expect(onArchiveLinkedEmail).toHaveBeenCalledWith([
            {
                key: 'email_google_ada@example.com:msg-1',
                connectionProjectId: 'email_google_ada@example.com',
                messageId: 'msg-1',
                commentId: 'comment-1',
                projectId: 'project-1',
                chatId: 'chat-1',
                commentRefs: [{ projectId: 'project-1', chatId: 'chat-1', commentId: 'comment-1' }],
            },
        ])
    })

    it('reflects the in-flight and archived states the shared hook reports', () => {
        const archived = renderPreviewMessage({ isArchivedEmail: () => true })
        expect(
            archived.root.findAll(node => node.type === Text && node.props.children === 'Archived').length
        ).toBeGreaterThan(0)

        const archiving = renderPreviewMessage({ isArchivingEmail: () => true })
        const button = archiving.root.findAll(
            node => node.type === TouchableOpacity && node.props.accessibilityLabel === 'Archive email'
        )[0]
        expect(button.props.disabled).toBe(true)
    })

    // AT-2424: the archive is optimistic, so from the press onwards BOTH are true - the key is
    // marked archived immediately while the mailbox call runs for another 4-8s. "Archived" has to
    // win, or the one thing left on screen would be a spinner saying the work had not happened
    // while the row it belongs to has already left the unread list.
    it('shows Archived rather than a spinner while an optimistically archived email is still in flight', () => {
        const tree = renderPreviewMessage({ isArchivedEmail: () => true, isArchivingEmail: () => true })

        expect(tree.root.findAll(node => node.type === Text && node.props.children === 'Archived').length).toBe(1)
        expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0)
    })

    it('offers Unsubscribe only when the email carries a usable unsubscribe target', () => {
        const withoutUnsubscribe = renderPreviewMessage()
        expect(labels(withoutUnsubscribe)).not.toEqual(expect.arrayContaining(['Unsubscribe']))

        const tree = renderPreviewMessage({
            message: emailMessage({
                gmailData: { ...GMAIL_DATA, unsubscribe: { httpsUrl: 'https://example.com/unsubscribe' } },
            }),
        })

        pressByLabel(tree, 'Unsubscribe')
        expect(openUrlInNewTab).toHaveBeenCalledWith('https://example.com/unsubscribe')
    })

    it('creates the task and marks the source email message as read in Alldone', async () => {
        performEmailLineAction.mockResolvedValue({ taskId: 'task-1', projectId: 'project-1' })
        markAlldoneChatsReadForLinkedEmails.mockResolvedValue()
        const tree = renderPreviewMessage()

        await act(async () => {
            pressByLabel(tree, 'Create task')
        })

        expect(performEmailLineAction).toHaveBeenCalledWith(
            'email_google_ada@example.com',
            expect.objectContaining({ action: 'createTask', messageIds: ['msg-1'] })
        )
        expect(markAlldoneChatsReadForLinkedEmails).toHaveBeenCalledWith([
            expect.objectContaining({
                connectionProjectId: 'email_google_ada@example.com',
                messageId: 'msg-1',
                projectId: 'project-1',
                chatId: 'chat-1',
                commentId: 'comment-1',
            }),
        ])
    })

    it('keeps the source email unread in Alldone when task creation fails', async () => {
        performEmailLineAction.mockImplementation((connectionId, params) =>
            params.action === 'createTask' ? Promise.reject(new Error('offline')) : Promise.resolve({})
        )
        const tree = renderPreviewMessage()

        await act(async () => {
            pressByLabel(tree, 'Create task')
        })

        expect(markAlldoneChatsReadForLinkedEmails).not.toHaveBeenCalled()
    })

    it('badges a new email in the preview header, and only when it is one', () => {
        const withBadge = renderPreviewMessage({ linkedEmailNew: true })
        expect(withBadge.root.findAll(node => node.props?.testID === 'email-new-badge')).toHaveLength(1)

        const withoutBadge = renderPreviewMessage({ linkedEmailNew: false })
        expect(withoutBadge.root.findAll(node => node.props?.testID === 'email-new-badge')).toHaveLength(0)

        // A non-member sees no badge either, matching MessageItem's `accessGranted && linkedEmail`.
        const noAccess = renderPreviewMessage({ linkedEmailNew: true, accessGranted: false })
        expect(noAccess.root.findAll(node => node.props?.testID === 'email-new-badge')).toHaveLength(0)
    })
})
