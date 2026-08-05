/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'

import GlobalUserInfo from '../../../../components/SettingsView/Profile/Properties/GlobalUserInfo'
import ProjectHelper from '../../../../components/SettingsView/ProjectsSettings/ProjectHelper'

jest.mock('react-redux', () => ({
    useSelector: jest.fn(),
}))

jest.mock('react-tiny-popover', () => {
    const React = require('react')
    return function Popover({ children, content }) {
        return (
            <>
                {children}
                {content}
            </>
        )
    }
})
jest.mock('../../../../components/UIControls/Button', () => 'Button')
jest.mock('../../../../components/Icon', () => 'Icon')
jest.mock('../../../../components/UIComponents/FloatModals/ChangeContactInfoModal', () => 'ChangeContactInfoModal')
jest.mock('../../../../i18n/TranslationService', () => ({
    translate: value => value,
}))
jest.mock('../../../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {
        setUserInfoGlobally: jest.fn(),
    },
}))

describe('GlobalUserInfo', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        useSelector.mockImplementation(selector =>
            selector({
                smallScreen: false,
                smallScreenNavigation: false,
            })
        )
    })

    it('hides description editing and preserves the existing description on save', async () => {
        const tree = renderer.create(
            <GlobalUserInfo userId="user-1" role="Engineer" company="Acme" description="Existing bio" />
        )

        const modal = tree.root.findByType('ChangeContactInfoModal')
        const renderedTexts = tree.root
            .findAllByType(Text)
            .map(node => node.props.children)
            .flat()

        expect(modal.props.hideDescription).toEqual(true)
        expect(renderedTexts).toContain('Engineer • Acme')
        expect(renderedTexts).not.toContain('Existing bio')

        await act(async () => {
            await modal.props.onSaveData({ role: 'Lead', company: 'Beta', description: 'New bio' })
        })

        expect(ProjectHelper.setUserInfoGlobally).toHaveBeenCalledWith('user-1', 'Lead', 'Beta', 'Existing bio')
    })
})
