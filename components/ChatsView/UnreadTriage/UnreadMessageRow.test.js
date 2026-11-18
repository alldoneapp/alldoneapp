/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet, View } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import UnreadMessageRow, { UNREAD_SUMMARY_WORD_STYLE } from './UnreadMessageRow'
import { buildUnreadRows } from './UnreadMessagesList'

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

const renderRow = ({ mobile }) => {
    const [row] = buildUnreadRows('project-1', [chat], { [chat.id]: [message] })
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
    ['desktop', false],
    ['mobile', true],
])('a long unread message on %s (AT-3094)', (_, mobile) => {
    it('hands SocialText the whole message, not a shortened summary', () => {
        const { tree } = renderRow({ mobile })
        const social = findSocialText(tree)
        const text = social.props.children

        expect(text).toContain('Gepusht nach main')
        expect(text.endsWith('LETZTES_WORT')).toBe(true)
        expect(text).not.toContain('...')
        // Plain text: the markdown heading marker is still stripped.
        expect(text.startsWith('Pushed Gepusht')).toBe(true)
        expect(social.props.numberOfLines).toBeUndefined()
        expect(social.props.wrapText).toBe(true)
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
