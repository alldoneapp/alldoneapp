/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet, Text } from 'react-native'
import renderer from 'react-test-renderer'

import MessageItemHeader from './MessageItemHeader'
import AssistantAvatar from '../../../AdminPanel/Assistants/AssistantAvatar'

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: (value, params = {}) =>
        value === 'Actor via MCP client' ? `${params.name} (via ${params.client})` : value,
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

    test.each(['carl.png', { uri: 'carl.png' }, undefined])(
        'uses the assistant avatar before the name (%s)',
        photoURL => {
            const tree = renderer.create(
                <MessageItemHeader
                    {...defaultProps}
                    message={{ ...defaultProps.message, creatorId: 'carl' }}
                    creatorData={{ displayName: 'Carl', isAssistant: true, photoURL }}
                />
            )
            const header = tree.root.findByProps({ testID: 'message-item-header' })
            expect(header.findByType(AssistantAvatar).props).toEqual(
                expect.objectContaining({
                    assistantId: 'carl',
                    photoURL: photoURL?.uri || photoURL,
                    size: 24,
                })
            )
        }
    )

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

    const headerName = tree =>
        tree.root
            .findAllByType(Text)
            .map(node => node.props.children)
            .find(children => typeof children === 'string' && children.startsWith('Ada'))

    test('shows a comment an MCP client wrote under the user, with the client', () => {
        const tree = renderer.create(
            <MessageItemHeader
                {...defaultProps}
                message={{ ...defaultProps.message, via: 'mcp', viaClient: 'Claude' }}
            />
        )
        expect(headerName(tree)).toBe('Ada (via Claude)')
    })

    test("shows the user's own comment under their name alone", () => {
        const tree = renderer.create(<MessageItemHeader {...defaultProps} />)
        expect(headerName(tree)).toBe('Ada')
    })
})
