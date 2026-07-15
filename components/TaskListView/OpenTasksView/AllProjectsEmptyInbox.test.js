import React from 'react'
import renderer from 'react-test-renderer'
import { useDispatch, useSelector } from 'react-redux'

import AllProjectsEmptyInbox from './AllProjectsEmptyInbox'
import NavigationService from '../../../utils/NavigationService'
import { navigateToSettings } from '../../../redux/actions'
import { DV_TAB_SETTINGS_PROFILE } from '../../../utils/TabNavigationConstants'

jest.mock('react-redux', () => ({
    useDispatch: jest.fn(),
    useSelector: jest.fn(),
}))
jest.mock('../../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../../../redux/actions', () => ({
    navigateToSettings: jest.fn(options => ({ type: 'Navigate to settings', options })),
}))
jest.mock('./AllProjectsEmptyInboxTags', () => 'AllProjectsEmptyInboxTags')
jest.mock('./AllProjectsEmptyInboxText', () => 'AllProjectsEmptyInboxText')
jest.mock('./AllProjectsEmptyInboxPicture', () => 'AllProjectsEmptyInboxPicture')
jest.mock('../../SettingsView/Profile/Achievements/AchievementsArea', () => ({
    EmptyInboxOverview: 'EmptyInboxOverview',
}))

describe('AllProjectsEmptyInbox', () => {
    const loggedUser = { uid: 'user-1', emptyInboxDays: ['2026-07-02'] }
    const dispatch = jest.fn()

    beforeEach(() => {
        jest.clearAllMocks()
        useDispatch.mockReturnValue(dispatch)
        useSelector.mockImplementation(selector => selector({ loggedUser }))
    })

    it('shows the achievement overview only when requested by the open-task view', () => {
        const genericEmptyInbox = renderer.create(<AllProjectsEmptyInbox />)
        expect(genericEmptyInbox.root.findAllByType('EmptyInboxOverview')).toHaveLength(0)

        const openTasksEmptyInbox = renderer.create(<AllProjectsEmptyInbox showEmptyInboxOverview />)
        const overview = openTasksEmptyInbox.root.findByType('EmptyInboxOverview')
        const children = openTasksEmptyInbox.root.findByType('View').children

        expect(overview.props.user).toBe(loggedUser)
        expect(overview.props.celebrateNewDay).toBe(true)
        overview.props.onOpenAchievements()
        const settingsOptions = {
            selectedNavItem: DV_TAB_SETTINGS_PROFILE,
            settingsScrollToTopToken: expect.any(Number),
        }
        expect(navigateToSettings).toHaveBeenCalledWith(settingsOptions)
        expect(dispatch).toHaveBeenCalledWith({
            type: 'Navigate to settings',
            options: settingsOptions,
        })
        expect(NavigationService.navigate).toHaveBeenCalledWith('SettingsView')
        expect(children[children.length - 2].type).toBe('AllProjectsEmptyInboxPicture')
        expect(children[children.length - 1].type).toBe('EmptyInboxOverview')
    })
})
