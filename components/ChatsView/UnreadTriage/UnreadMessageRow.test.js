/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet, View } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import UnreadMessageRow, { UNREAD_SUMMARY_WORD_STYLE } from './UnreadMessageRow'
import { buildUnreadRows } from './UnreadMessagesList'
import { UNREAD_SUMMARY_CHARACTER_LIMIT, UNREAD_SUMMARY_CHARACTER_LIMIT_MOBILE } from './unreadMessageTags'

jest.mock('react-redux', () => ({ useSelector: () => undefined }))
jest.mock('../../../hooks/Chats/useGetUnreadChatMessages', () => jest.fn())
jest.mock('../../../utils/SharedHelper', () => ({ accessGranted: () => true }))
jest.mock('../../ContactsView/Utils/ContactsHelper', () => ({
    getUserPresentationData: () => ({ displayName: 'Karsten Wysk' }),
}))
jest.mock('../../ContactsView/Utils/useGetUserPresentationData', () => () => ({
    displayName: 'Karsten Wysk',
    photoURL: 'https://example.com/karsten.png',
}))
jest.mock('../../../utils/backends/EmailLine/emailCommentReadSync', () => ({ syncEmailCommentsReadState: jest.fn() }))
jest.mock('../../../utils/backends/EmailLine/emailLineBackend', () => ({ performEmailLineAction: jest.fn() }))
jest.mock('../../../utils/backends/Chats/markChatCommentsAsRead', () => ({
    markChatCommentsAsRead: jest.fn(async () => {}),
    markAlldoneChatsReadForLinkedEmails: jest.fn(async () => {}),
    clearChatCommentsForLinkedEmails: jest.fn(async () => async () => {}),
}))
jest.mock('../../../i18n/TranslationService', () => ({
    translate: (key, vars = {}) => (key === 'Actor via MCP client' ? `${vars.name} (via ${vars.client})` : key),
}))
jest.mock('../Utils/ChatHelper', () => ({ onOpenChat: jest.fn() }))
jest.mock('../../TaskListView/EmailLine/emailLineHelper', () => ({ openUrlInNewTab: jest.fn() }))
jest.mock('../../UIComponents/FloatModals/DateFormatPickerModal', () => ({
    getDateFormat: () => 'DD.MM.YYYY',
    getTimeFormat: () => 'HH:mm',
}))
// Records what the row hands SocialText: the text, the container style and the per-word style.
jest.mock('../../UIControls/SocialText/SocialText', () => {
    const { Text } = require('react-native')
    const MockSocialText = props => <Text testID="unread-summary">{props.children}</Text>
    return MockSocialText
})
jest.mock('../../Icon', () => () => null)
jest.mock('../../../assets/svg/SVGGenericUser', () => () => null)

// The first entry of the screenshot in AT-3094: long enough for three and more lines on a desktop.
const LONG_MESSAGE =
    '## Pushed\n' +
    'Gepusht nach main (adb6aa89..d446b62c): 21c5668e Core (Label-Suche liest deutsche Narration auch unter EN), ' +
    '46f5d3d4 Platform (keine Abbuchung, wenn die Suche nicht läuft), d446b62c UI (Wortabstand in den ' +
    'Caption-Karten). Der Deploy läuft über firebase deploy; danach prüfe ich die Story-Schritte mit der ' +
    'Audience-Story, die Untertitel, die Anführungszeichen und den Wortabstand auf dem Handy und am Desktop, ' +
    'und melde mich mit dem Ergebnis und den Screenshots zurück. LETZTES_WORT'

const chat = { id: 'chat-1', type: 'tasks', title: 'Story Builder: Johannas 3. Feedback-Runde' }
const message = {
    id: 'c-long',
    creatorId: 'karsten',
    fromAssistant: false,
    via: 'mcp',
    viaClient: 'Claude',
    created: 100,
    commentText: LONG_MESSAGE,
}

const renderRow = ({ mobile, commentText = LONG_MESSAGE }) => {
    const [row] = buildUnreadRows('project-1', [chat], { [chat.id]: [{ ...message, commentText }] })
    let tree
    act(() => {
        tree = renderer.create(<UnreadMessageRow projectId="project-1" row={row} accessGranted mobile={mobile} />)
    })
    return { tree, row }
}

const HEIGHT_CAPS = ['height', 'maxHeight']
const findSocialText = tree =>
    tree.root.find(node => node.props.wrapText !== undefined && node.props.textStyle !== undefined)

describe.each([
    ['desktop', false, UNREAD_SUMMARY_CHARACTER_LIMIT],
    ['mobile', true, UNREAD_SUMMARY_CHARACTER_LIMIT_MOBILE],
])('a long unread message on %s (AT-3094, AT-3106)', (_, mobile, limit) => {
    it('previews at most the character limit and ends with "..."', () => {
        const { tree, row } = renderRow({ mobile })
        const social = findSocialText(tree)
        const text = social.props.children

        // The row data keeps the whole message; only the rendered preview is shortened.
        expect(row.summary.endsWith('LETZTES_WORT')).toBe(true)
        expect(row.summary.length).toBeGreaterThan(UNREAD_SUMMARY_CHARACTER_LIMIT)

        expect(text.startsWith('Pushed Gepusht nach main')).toBe(true)
        expect(text.endsWith('...')).toBe(true)
        expect(text).not.toContain('LETZTES_WORT')
        expect(text.length).toBeLessThanOrEqual(limit + '...'.length)
        // Cut between words: what precedes the dots is the start of the whole message.
        expect(row.summary.startsWith(text.slice(0, -3))).toBe(true)
        expect(row.summary[text.length - 3]).toMatch(/[\s.,;:!?)-]/)
        expect(social.props.numberOfLines).toBeUndefined()
        expect(social.props.wrapText).toBe(true)
    })

    it('keeps the whole message in the accessibility label', () => {
        const { tree } = renderRow({ mobile })
        const rowNode = tree.root.find(node => node.props.testID === 'unread-row-c-long' && node.props.onPress)
        expect(rowNode.props.accessibilityLabel).toContain('LETZTES_WORT')
    })

    it('shows a message within the limit unchanged, without dots', () => {
        const { tree } = renderRow({ mobile, commentText: 'Kurze Nachricht: passt in die Zeile.' })
        expect(findSocialText(tree).props.children).toBe('Kurze Nachricht: passt in die Zeile.')
    })

    it('puts no fixed or maximum height and no clipping on the text or the row', () => {
        const { tree } = renderRow({ mobile })
        const social = findSocialText(tree)
        const summaryStyle = StyleSheet.flatten(social.props.style) || {}
        HEIGHT_CAPS.forEach(key => expect(summaryStyle[key]).toBeUndefined())
        expect(summaryStyle.overflow).not.toBe('hidden')

        const rowNode = tree.root.find(node => node.props.testID === 'unread-row-c-long' && node.props.onPress)
        const rowStyle = StyleSheet.flatten(rowNode.props.style)
        HEIGHT_CAPS.forEach(key => expect(rowStyle[key]).toBeUndefined())
        expect(rowStyle.overflow).not.toBe('hidden')
        // The separator and the unread edge stay on the row, whatever its height.
        expect(rowStyle.borderBottomWidth).toBe(1)
        expect(rowStyle.borderLeftWidth).toBe(3)
    })

    it('lets a word wider than the column break instead of overflowing', () => {
        const { tree } = renderRow({ mobile })
        const social = findSocialText(tree)
        expect(social.props.normalStyle).toBe(UNREAD_SUMMARY_WORD_STYLE)
        expect(UNREAD_SUMMARY_WORD_STYLE).toMatchObject({ maxWidth: '100%', overflowWrap: 'anywhere' })
    })

    it('keeps the actions at the top of a tall row and the avatar and time on the left', () => {
        const { tree } = renderRow({ mobile })
        const actions = tree.root.find(node => node.type === View && node.props.testID === 'unread-row-actions-c-long')
        const actionsStyle = StyleSheet.flatten(actions.props.style)
        expect(actionsStyle.alignSelf).toBe('flex-start')
        expect(actionsStyle.flexShrink).toBe(0)
        expect(
            actions.findAll(node => node.props.accessibilityLabel === 'mark as read' && node.props.onPress)
        ).not.toHaveLength(0)
        expect(
            actions.findAll(node => node.props.accessibilityLabel === 'Open chat' && node.props.onPress)
        ).not.toHaveLength(0)

        const json = JSON.stringify(tree.toJSON())
        expect(json).toContain('Karsten Wysk (via Claude)')
        expect(json).toContain('https://example.com/karsten.png')
    })
})

// AT-3107: on a phone the three actions of a message (archive, mark as read, open chat) stack at the
// right edge instead of sitting side by side, so the sender, tag and message get the width back.
describe('the action icons on a phone and on a desktop (AT-3107)', () => {
    const UnreadEmailArchiveContext = require('../unreadEmailArchiveContext').default
    const { TouchableOpacity } = require('react-native')

    const emailRow = {
        key: 'chat-1:c-mail',
        message: { id: 'c-mail', created: 100, gmailData: {} },
        chat: { id: 'chat-1', type: 'topics', title: 'Daily emails' },
        isEmail: true,
        tag: 'notification',
        senderName: 'LinkedIn Jobalerts',
        summary: 'LinkedIn-Jobalert für „Client Experience Partner – AI & Agentic Experience“',
        time: 100,
        linkedEmail: { key: 'gmail-1' },
    }

    const archive = {
        isArchivingEmail: () => false,
        isFailedEmail: () => false,
        archiveLinkedEmails: jest.fn(async () => {}),
    }

    const renderEmailRow = mobile => {
        let tree
        act(() => {
            tree = renderer.create(
                <UnreadEmailArchiveContext.Provider value={{ archive }}>
                    <UnreadMessageRow projectId="project-1" row={emailRow} accessGranted mobile={mobile} />
                </UnreadEmailArchiveContext.Provider>
            )
        })
        return tree
    }

    const styleOf = (tree, testID) =>
        StyleSheet.flatten(tree.root.find(node => node.type === View && node.props.testID === testID).props.style)

    const actionButtons = tree => {
        const actions = tree.root.find(node => node.type === View && node.props.testID === 'unread-row-actions-c-mail')
        // One node per button: TouchableOpacity also hands its props to the View it renders.
        return actions.findAll(node => node.type === TouchableOpacity && node.props.accessibilityRole === 'button')
    }

    it('stacks archive, mark as read and open chat in one column at the top right on a phone', () => {
        const tree = renderEmailRow(true)
        const actionsStyle = styleOf(tree, 'unread-row-actions-c-mail')
        expect(actionsStyle.flexDirection).toBe('column')
        expect(actionsStyle.alignSelf).toBe('flex-start')
        expect(actionsStyle.flexShrink).toBe(0)

        expect(actionButtons(tree).map(node => node.props.accessibilityLabel)).toEqual([
            'Archive email',
            'mark as read',
            'Open chat',
        ])
    })

    it('keeps every action a 32 x 32 touch target on a phone', () => {
        const tree = renderEmailRow(true)
        actionButtons(tree).forEach(node => {
            const style = StyleSheet.flatten(node.props.style)
            expect(style.width).toBeGreaterThanOrEqual(32)
            expect(style.height).toBeGreaterThanOrEqual(32)
        })
    })

    it('still runs each action on a phone without opening the row', () => {
        const tree = renderEmailRow(true)
        const { onOpenChat } = require('../Utils/ChatHelper')
        const { markChatCommentsAsRead } = require('../../../utils/backends/Chats/markChatCommentsAsRead')
        const { openUrlInNewTab } = require('../../TaskListView/EmailLine/emailLineHelper')
        onOpenChat.mockClear()
        openUrlInNewTab.mockClear()
        const [archiveButton, markReadButton, openChatButton] = actionButtons(tree)
        const event = { stopPropagation: jest.fn() }

        act(() => {
            archiveButton.props.onPress(event)
            markReadButton.props.onPress(event)
            openChatButton.props.onPress(event)
        })

        expect(archive.archiveLinkedEmails).toHaveBeenCalledWith([emailRow.linkedEmail])
        expect(markChatCommentsAsRead).toHaveBeenCalledWith([
            { projectId: 'project-1', chatId: 'chat-1', commentId: 'c-mail' },
        ])
        expect(onOpenChat).toHaveBeenCalledWith('project-1', emailRow.chat)
        expect(event.stopPropagation).toHaveBeenCalledTimes(3)
        expect(openUrlInNewTab).not.toHaveBeenCalled()
    })

    it('lets the tag shrink with "..." on a phone instead of running under the icons', () => {
        const tree = renderEmailRow(true)
        const tagStyle = styleOf(tree, 'unread-row-tag-c-mail')
        expect(tagStyle.flexShrink).toBe(1)
        expect(tagStyle.minWidth).toBe(0)
    })

    it('leaves the desktop row as it was: icons side by side, the tag whole', () => {
        const tree = renderEmailRow(false)
        const actionsStyle = styleOf(tree, 'unread-row-actions-c-mail')
        expect(actionsStyle.flexDirection).toBe('row')
        expect(actionsStyle.marginLeft).toBe(8)
        expect(actionButtons(tree)).toHaveLength(3)

        const tagStyle = styleOf(tree, 'unread-row-tag-c-mail')
        expect(tagStyle.flexShrink).toBe(0)
        expect(tagStyle.minWidth).toBeUndefined()
    })
})

describe('"Create email task" on an email row (AT-3165)', () => {
    const UnreadEmailArchiveContext = require('../unreadEmailArchiveContext').default
    const { TouchableOpacity } = require('react-native')
    const { performEmailLineAction } = require('../../../utils/backends/EmailLine/emailLineBackend')
    const { markAlldoneChatsReadForLinkedEmails } = require('../../../utils/backends/Chats/markChatCommentsAsRead')

    const linkedEmail = {
        key: 'email_google_me:gm-1',
        connectionProjectId: 'email_google_me',
        messageId: 'gm-1',
        commentRefs: [{ projectId: 'project-1', chatId: 'chat-1', commentId: 'c-mail' }],
    }
    const buildEmailRow = (overrides = {}) => ({
        key: 'chat-1:c-mail',
        message: { id: 'c-mail', created: 100, gmailData: { messageId: 'gm-1', connectionId: 'email_google_me' } },
        chat: { id: 'chat-1', type: 'topics', title: 'Daily emails' },
        isEmail: true,
        tag: 'person',
        senderName: 'Bob',
        summary: 'Can you send the contract?',
        time: 100,
        linkedEmail,
        ...overrides,
    })
    const archive = {
        isArchivingEmail: () => false,
        isFailedEmail: () => false,
        archiveLinkedEmails: jest.fn(async () => {}),
    }

    const renderRow = (row, { accessGranted = true } = {}) => {
        let tree
        act(() => {
            tree = renderer.create(
                <UnreadEmailArchiveContext.Provider value={{ archive }}>
                    <UnreadMessageRow projectId="project-1" row={row} accessGranted={accessGranted} />
                </UnreadEmailArchiveContext.Provider>
            )
        })
        return tree
    }
    const findByLabel = (tree, label) =>
        tree.root.findAll(node => node.type === TouchableOpacity && node.props.accessibilityLabel === label)

    beforeEach(() => {
        performEmailLineAction.mockReset()
        markAlldoneChatsReadForLinkedEmails.mockClear()
        archive.archiveLinkedEmails.mockClear()
    })

    it('offers the action next to archive, before mark as read', () => {
        const tree = renderRow(buildEmailRow())
        const actions = tree.root.find(node => node.type === View && node.props.testID === 'unread-row-actions-c-mail')
        const labels = actions
            .findAll(node => node.type === TouchableOpacity && node.props.accessibilityLabel)
            .map(node => node.props.accessibilityLabel)
        expect(labels).toEqual(['Archive email', 'Create email task', 'mark as read', 'Open chat'])
    })

    it('is not offered for a chat message, an email without a mailbox link, or without access', () => {
        expect(
            findByLabel(renderRow(buildEmailRow({ isEmail: false, linkedEmail: null })), 'Create email task')
        ).toEqual([])
        expect(findByLabel(renderRow(buildEmailRow({ linkedEmail: { key: 'x' } })), 'Create email task')).toEqual([])
        expect(findByLabel(renderRow(buildEmailRow(), { accessGranted: false }), 'Create email task')).toEqual([])
    })

    it('creates the task through the email line flow for exactly this message, then marks the row read', async () => {
        performEmailLineAction.mockResolvedValue({ taskId: 't-new', projectId: 'project-1', taskName: 'Send contract' })
        const tree = renderRow(buildEmailRow())

        await act(async () => {
            findByLabel(tree, 'Create email task')[0].props.onPress()
        })

        expect(performEmailLineAction).toHaveBeenCalledTimes(1)
        expect(performEmailLineAction).toHaveBeenCalledWith('email_google_me', {
            action: 'createTask',
            messageIds: ['gm-1'],
            labelId: null,
            labelName: null,
        })
        expect(markAlldoneChatsReadForLinkedEmails).toHaveBeenCalledWith([linkedEmail])
        expect(findByLabel(tree, 'Task created')).toHaveLength(1)
        // Creating a task is not archiving: the mail stays where it is in Gmail.
        expect(archive.archiveLinkedEmails).not.toHaveBeenCalled()
    })

    it('repeated clicks while the request runs send one request', async () => {
        let resolveCreate
        performEmailLineAction.mockReturnValue(
            new Promise(resolve => {
                resolveCreate = resolve
            })
        )
        const tree = renderRow(buildEmailRow())
        const button = findByLabel(tree, 'Create email task')[0]

        act(() => {
            button.props.onPress()
            button.props.onPress()
        })
        await act(async () => {
            resolveCreate({ taskId: 't-new', projectId: 'project-1' })
        })

        expect(performEmailLineAction).toHaveBeenCalledTimes(1)
        expect(markAlldoneChatsReadForLinkedEmails).toHaveBeenCalledTimes(1)
    })

    it('the row and the thread button for the same email share one request when pressed together', async () => {
        let resolveCreate
        performEmailLineAction.mockReturnValue(
            new Promise(resolve => {
                resolveCreate = resolve
            })
        )
        const first = renderRow(buildEmailRow())
        const second = renderRow(buildEmailRow())

        act(() => {
            findByLabel(first, 'Create email task')[0].props.onPress()
            findByLabel(second, 'Create email task')[0].props.onPress()
        })
        await act(async () => {
            resolveCreate({ taskId: 't-new', projectId: 'project-1' })
        })

        expect(performEmailLineAction).toHaveBeenCalledTimes(1)
        expect(findByLabel(first, 'Task created')).toHaveLength(1)
        expect(findByLabel(second, 'Task created')).toHaveLength(1)
    })

    it('an email that already has a task shows it and does not ask again', () => {
        const tree = renderRow(
            buildEmailRow({
                message: {
                    id: 'c-mail',
                    created: 100,
                    gmailData: { messageId: 'gm-1', taskCreated: { taskId: 't-old', projectId: 'project-1' } },
                },
            })
        )
        expect(findByLabel(tree, 'Task created')).toHaveLength(1)
        expect(findByLabel(tree, 'Create email task')).toHaveLength(0)
        expect(performEmailLineAction).not.toHaveBeenCalled()
    })

    it('a server answer with the existing task shows it as created and creates nothing else', async () => {
        performEmailLineAction.mockResolvedValue({
            taskId: 't-old',
            projectId: 'project-1',
            existing: true,
            goldCost: 0,
        })
        const tree = renderRow(buildEmailRow())
        await act(async () => {
            findByLabel(tree, 'Create email task')[0].props.onPress()
        })
        expect(findByLabel(tree, 'Task created')).toHaveLength(1)
        expect(performEmailLineAction).toHaveBeenCalledTimes(1)
    })

    it('a failed request keeps the row unread and can be tried again', async () => {
        performEmailLineAction.mockRejectedValueOnce(new Error('unavailable'))
        const tree = renderRow(buildEmailRow())
        await act(async () => {
            findByLabel(tree, 'Create email task')[0].props.onPress()
        })
        expect(markAlldoneChatsReadForLinkedEmails).not.toHaveBeenCalled()

        performEmailLineAction.mockResolvedValueOnce({ taskId: 't-new', projectId: 'project-1' })
        await act(async () => {
            findByLabel(tree, 'Create email task')[0].props.onPress()
        })
        expect(performEmailLineAction).toHaveBeenCalledTimes(2)
        expect(markAlldoneChatsReadForLinkedEmails).toHaveBeenCalledTimes(1)
    })

    it('a press on the action does not also open the email', () => {
        const tree = renderRow(buildEmailRow())
        const wrapper = tree.root.find(
            node => node.type === View && node.props.testID === 'unread-row-create-task-c-mail'
        )
        const event = { stopPropagation: jest.fn() }
        wrapper.props.onClick(event)
        expect(event.stopPropagation).toHaveBeenCalled()
    })
})
