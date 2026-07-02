import React from 'react'
import renderer from 'react-test-renderer'
import { useSelector } from 'react-redux'

import AllProjectsEmptyInbox from './AllProjectsEmptyInbox'

jest.mock('react-redux', () => ({
    useSelector: jest.fn(),
}))
jest.mock('./AllProjectsEmptyInboxTags', () => 'AllProjectsEmptyInboxTags')
jest.mock('./AllProjectsEmptyInboxText', () => 'AllProjectsEmptyInboxText')
jest.mock('./AllProjectsEmptyInboxPicture', () => 'AllProjectsEmptyInboxPicture')
jest.mock('../../SettingsView/Profile/Achievements/AchievementsArea', () => ({
    EmptyInboxOverview: 'EmptyInboxOverview',
}))

describe('AllProjectsEmptyInbox', () => {
    const loggedUser = { uid: 'user-1', emptyInboxDays: ['2026-07-02'] }

    beforeEach(() => {
        useSelector.mockImplementation(selector => selector({ loggedUser }))
    })

    it('shows the achievement overview only when requested by the open-task view', () => {
        const genericEmptyInbox = renderer.create(<AllProjectsEmptyInbox />)
        expect(genericEmptyInbox.root.findAllByType('EmptyInboxOverview')).toHaveLength(0)

        const openTasksEmptyInbox = renderer.create(<AllProjectsEmptyInbox showEmptyInboxOverview />)
        const overview = openTasksEmptyInbox.root.findByType('EmptyInboxOverview')

        expect(overview.props.user).toBe(loggedUser)
    })
})
