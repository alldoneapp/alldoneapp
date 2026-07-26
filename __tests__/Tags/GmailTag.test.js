import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { TouchableOpacity } from 'react-native'

import GmailTag from '../../components/Tags/GmailTag'
import { openUrlInNewTab } from '../../components/TaskListView/EmailLine/emailLineHelper'

jest.mock('../../components/Icon', () => 'Icon')
jest.mock('react-redux', () => ({ useSelector: jest.fn(selector => selector({ smallScreen: false })) }))
jest.mock('react-tiny-popover', () => ({ children, content, isOpen }) => (
    <>
        {children}
        {isOpen ? content : null}
    </>
))
jest.mock('../../components/TaskListView/EmailLine/emailLineHelper', () => ({
    openUrlInNewTab: jest.fn(),
}))
jest.mock('../../components/TaskListView/EmailLine/EmailLabelModal/DraftReplyPopup', () => 'DraftReplyPopup')
jest.mock('../../i18n/TranslationService', () => ({ translate: jest.fn(key => key) }))

const touchableContaining = (tree, text) =>
    tree.root
        .findAllByType(TouchableOpacity)
        .find(node => node.findAll(child => child.props.children === text).length > 0)

describe('GmailTag', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('renders null when gmailData is null', () => {
        const tree = renderer.create(<GmailTag gmailData={null} />).toJSON()

        expect(tree).toBeNull()
    })

    test('renders without unread count when unreadMails is missing', () => {
        const tree = renderer.create(<GmailTag gmailData={{ email: 'person@example.com' }} />)

        expect(tree.root.findAllByType('Text')).toHaveLength(0)
    })

    test('stops the press event and opens the email directly', () => {
        const tree = renderer.create(<GmailTag gmailData={{ email: 'person@example.com', messageId: 'abc123' }} />)
        const stopPropagation = jest.fn()
        const preventDefault = jest.fn()

        act(() => {
            tree.root.findByType(TouchableOpacity).props.onPress({ stopPropagation, preventDefault })
        })

        // The tag used to open a popover offering Open Email and Draft Reply.
        // It links straight through now, so the press itself is the action.
        expect(stopPropagation).toHaveBeenCalled()
        expect(preventDefault).toHaveBeenCalled()
        expect(openUrlInNewTab).toHaveBeenCalledWith(expect.stringContaining('mail.google.com'))
    })

    test('points the link at the message it was given', () => {
        const tree = renderer.create(<GmailTag gmailData={{ email: 'person@example.com', messageId: 'abc123' }} />)

        act(() => {
            tree.root
                .findByType(TouchableOpacity)
                .props.onPress({ stopPropagation: jest.fn(), preventDefault: jest.fn() })
        })

        expect(openUrlInNewTab).toHaveBeenCalledWith(expect.stringContaining('abc123'))
    })
})
