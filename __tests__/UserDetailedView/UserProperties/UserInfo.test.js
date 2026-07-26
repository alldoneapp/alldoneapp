/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'

import UserInfo from '../../../components/UserDetailedView/UserProperties/UserInfo'
import ProjectHelper from '../../../components/SettingsView/ProjectsSettings/ProjectHelper'

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
jest.mock('../../../components/UIControls/Button', () => 'Button')
jest.mock('../../../components/Icon', () => 'Icon')
jest.mock('../../../components/UIComponents/FloatModals/ChangeContactInfoModal', () => 'ChangeContactInfoModal')
jest.mock('../../../i18n/TranslationService', () => ({
    translate: value => value,
}))
jest.mock('../../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {
        getUserRoleInProject: jest.fn(),
        getUserCompanyInProject: jest.fn(),
        getUserDescriptionInProject: jest.fn(),
        setUserInfoInProject: jest.fn(),
        checkIfLoggedUserIsNormalUserInGuide: jest.fn(),
    },
}))

describe('UserInfo', () => {
    const user = {
        uid: 'user-1',
        role: 'Engineer',
        company: 'Acme',
        description: 'Short bio',
        extendedDescription: 'Extended bio',
    }

    beforeEach(() => {
        jest.clearAllMocks()
        useSelector.mockImplementation(selector =>
            selector({
                smallScreen: false,
                smallScreenNavigation: false,
                loggedUser: { uid: 'user-1' },
            })
        )
        ProjectHelper.getUserRoleInProject.mockReturnValue('Engineer')
        ProjectHelper.getUserCompanyInProject.mockReturnValue('Acme')
        ProjectHelper.getUserDescriptionInProject.mockReturnValue('Extended bio')
        ProjectHelper.checkIfLoggedUserIsNormalUserInGuide.mockReturnValue(false)
    })

    it('hides description editing and preserves the project description on save', async () => {
        const tree = renderer.create(
            <UserInfo projectId="project-1" projectIndex={0} user={user} accessGranted={true} />
        )

        const modal = tree.root.findByType('ChangeContactInfoModal')
        const renderedTexts = tree.root
            .findAllByType('Text')
            .map(node => node.props.children)
            .flat()

        expect(modal.props.hideDescription).toEqual(true)
        expect(renderedTexts).toContain('Engineer • Acme')
        expect(renderedTexts).not.toContain('Extended bio')

        await act(async () => {
            await modal.props.onSaveData({ role: 'Lead', company: 'Beta', description: 'New bio' })
        })

        expect(ProjectHelper.setUserInfoInProject).toHaveBeenCalledWith(
            'project-1',
            0,
            'user-1',
            'Beta',
            'Lead',
            'Extended bio'
        )
    })
})
