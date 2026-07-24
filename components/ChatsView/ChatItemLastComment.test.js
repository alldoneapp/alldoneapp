/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'

import ChatItemLastComment from './ChatItemLastComment'
import { getUserPresentationDataInProject } from '../ContactsView/Utils/ContactsHelper'

jest.mock('../ContactsView/Utils/ContactsHelper', () => ({
    getUserPresentationDataInProject: jest.fn(),
}))

jest.mock('../UIControls/SocialText/SocialText', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return ({ children }) => <Text>{children}</Text>
})

jest.mock('../styles/global', () => ({
    __esModule: true,
    default: { caption2: {} },
    colors: { Text03: '#000000' },
}))

describe('ChatItemLastComment', () => {
    it('resolves the preview author within the chat project', () => {
        getUserPresentationDataInProject.mockReturnValue({ displayName: 'Anna' })

        const tree = renderer.create(
            <ChatItemLastComment projectId="project-1" commentOwnerId="project-assistant" comment="Interesting email" />
        )

        expect(getUserPresentationDataInProject).toHaveBeenCalledWith('project-1', 'project-assistant')
        expect(tree.root.findByType('Text').props.children).toBe('Anna: Interesting email')
    })
})
