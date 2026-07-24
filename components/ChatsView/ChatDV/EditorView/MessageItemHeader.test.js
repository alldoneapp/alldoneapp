/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet } from 'react-native'
import renderer from 'react-test-renderer'

import MessageItemHeader from './MessageItemHeader'

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: value => value,
}))

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
}))

jest.mock('../../Utils/ChatHelper', () => ({
    getTimestampInMilliseconds: value => value,
    parseLastEdited: () => 'now',
}))

jest.mock('../../../ContactsView/Utils/ContactsHelper', () => ({
    navigateToUserProfile: jest.fn(),
}))

jest.mock('../../../../utils/NavigationService', () => ({
    navigate: jest.fn(),
}))

jest.mock('../../../../redux/actions', () => ({
    setSelectedNavItem: jest.fn(),
}))

jest.mock('../../../AdminPanel/Assistants/assistantsHelper', () => ({
    getAssistantProjectId: jest.fn(),
}))

describe('MessageItemHeader', () => {
    const defaultProps = {
        projectId: 'project-1',
        message: {
            id: 'comment-1',
            creatorId: 'user-1',
            lastChangeDate: 1,
        },
        serverTime: 1,
        creatorData: {
            photoURL: { uri: 'avatar.png' },
            displayName: 'Ada',
            isProjectUser: true,
            isUnknownUser: false,
        },
        onEditPress: jest.fn(),
        editDisabled: true,
        accessGranted: true,
    }

    test('places a new email badge at the right of the comment header', () => {
        const tree = renderer.create(<MessageItemHeader {...defaultProps} linkedEmailNew />)
        const header = tree.root.findByProps({ testID: 'message-item-header' })
        const badge = header.findByProps({ testID: 'email-new-badge' })

        expect(StyleSheet.flatten(badge.props.style)).toEqual(
            expect.objectContaining({
                marginLeft: 'auto',
                marginRight: 8,
            })
        )
    })

    test('does not render the badge for other comments', () => {
        const tree = renderer.create(<MessageItemHeader {...defaultProps} linkedEmailNew={false} />)

        expect(tree.root.findAllByProps({ testID: 'email-new-badge' })).toHaveLength(0)
    })
})
