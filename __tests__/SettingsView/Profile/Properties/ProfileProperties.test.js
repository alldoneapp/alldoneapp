/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'
import { useSelector } from 'react-redux'

import ProfileProperties from '../../../../components/SettingsView/Profile/Properties/ProfileProperties'
import useInProfileSettings from '../../../../components/SettingsView/Profile/useInProfileSettings'
import SharedHelper from '../../../../utils/SharedHelper'
import ProjectHelper from '../../../../components/SettingsView/ProjectsSettings/ProjectHelper'

jest.mock('react-redux', () => ({
    useSelector: jest.fn(),
}))

jest.mock('../../../../components/SettingsView/Profile/useInProfileSettings')
jest.mock('react-tiny-popover', () => 'Popover')
jest.mock('../../../../utils/SharedHelper', () => ({
    __esModule: true,
    default: { accessGranted: jest.fn() },
}))
jest.mock('../../../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {
        checkIfLoggedUserIsNormalUserInGuide: jest.fn(),
        getUserDescriptionInProject: jest.fn(),
    },
}))
jest.mock('../../../../utils/backends/Users/usersFirestore', () => ({
    setUserDescription: jest.fn(),
    setUserDescriptionInProject: jest.fn(),
}))
jest.mock('../../../../components/SettingsView/Profile/Properties/GlobalXP', () => 'GlobalXP')
jest.mock('../../../../components/SettingsView/Profile/Properties/GlobalUserInfo', () => 'GlobalUserInfo')
jest.mock('../../../../components/SettingsView/Profile/Properties/GlobalUserPhone', () => 'GlobalUserPhone')
jest.mock('../../../../components/SettingsView/Profile/Properties/UserDescriptionField', () => 'UserDescriptionField')
jest.mock('../../../../components/UserDetailedView/UserProperties/UserInfo', () => 'UserInfo')
jest.mock('../../../../components/SettingsView/Profile/Properties/UserGold', () => 'UserGold')
jest.mock('../../../../components/SettingsView/Profile/Properties/GoldTransactionsModal', () => 'GoldTransactionsModal')

describe('ProfileProperties', () => {
    const user = { uid: 'user-1', gold: 5, description: 'User description', extendedDescription: 'Extended user bio' }

    beforeEach(() => {
        jest.clearAllMocks()
        useSelector.mockImplementation(selector =>
            selector({
                smallScreen: false,
                loggedUser: {
                    uid: 'user-1',
                    role: 'Engineer',
                    company: 'Acme',
                    description: 'Global description',
                    extendedDescription: 'Global extended description',
                    phone: '+491234',
                },
                loggedUserProjectsMap: { 'project-1': { id: 'project-1' } },
            })
        )
        useInProfileSettings.mockReturnValue(true)
        SharedHelper.accessGranted.mockReturnValue(true)
        ProjectHelper.checkIfLoggedUserIsNormalUserInGuide.mockReturnValue(false)
        ProjectHelper.getUserDescriptionInProject.mockReturnValue('Project scoped description')
    })

    it('prefers extendedDescription in settings', () => {
        const tree = renderer.create(<ProfileProperties user={user} />)

        expect(tree.root.findByType('UserDescriptionField').props.description).toEqual('Global extended description')
        expect(tree.root.findByType('UserDescriptionField').props.helperText).toEqual(
            'Global user description helper text'
        )
        expect(typeof tree.root.findByType('UserGold').props.onPress).toBe('function')
    })

    it('falls back to description in settings when extendedDescription is empty', () => {
        useSelector.mockImplementation(selector =>
            selector({
                smallScreen: false,
                loggedUser: {
                    uid: 'user-1',
                    role: 'Engineer',
                    company: 'Acme',
                    description: 'Global description',
                    extendedDescription: '',
                    phone: '+491234',
                },
                loggedUserProjectsMap: { 'project-1': { id: 'project-1' } },
            })
        )

        const tree = renderer.create(<ProfileProperties user={user} />)

        expect(tree.root.findByType('UserDescriptionField').props.description).toEqual('Global description')
    })

    it('uses an empty string in settings when both description fields are empty', () => {
        useSelector.mockImplementation(selector =>
            selector({
                smallScreen: false,
                loggedUser: {
                    uid: 'user-1',
                    role: 'Engineer',
                    company: 'Acme',
                    description: '',
                    extendedDescription: '',
                    phone: '+491234',
                },
                loggedUserProjectsMap: { 'project-1': { id: 'project-1' } },
            })
        )

        const tree = renderer.create(<ProfileProperties user={user} />)

        expect(tree.root.findByType('UserDescriptionField').props.description).toEqual('')
    })

    it('reuses the same description field in the per-project profile view', () => {
        useInProfileSettings.mockReturnValue(false)

        const tree = renderer.create(<ProfileProperties user={user} projectId="project-1" projectIndex={0} />)

        expect(ProjectHelper.getUserDescriptionInProject).toHaveBeenCalledWith(
            'project-1',
            'user-1',
            'User description',
            'Extended user bio',
            true
        )
        expect(tree.root.findByType('UserDescriptionField').props.description).toEqual('Project scoped description')
        expect(tree.root.findByType('UserDescriptionField').props.helperText).toEqual(
            'Project user description helper text'
        )
        expect(tree.root.findByType('UserGold').props.onPress).toBeUndefined()
    })
})
