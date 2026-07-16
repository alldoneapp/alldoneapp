/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'
import { useSelector } from 'react-redux'

import ProjectAndUserData from './ProjectAndUserData'
import useShowNewCommentsBubbleInBoard from '../../../hooks/Chats/useShowNewCommentsBubbleInBoard'

jest.mock('react-redux', () => ({
    useSelector: jest.fn(),
}))
jest.mock('../../Icon', () => 'Icon')
jest.mock('../../styles/global', () => ({
    colors: { Text02: '#666666' },
}))
jest.mock('./ProjectLine', () => 'ProjectLine')
jest.mock('./UserLine', () => 'UserLine')
jest.mock('./NotificationBubble', () => 'NotificationBubble')
jest.mock('../EmailLine/ProjectEmailLabelChips', () => 'ProjectEmailLabelChips')
jest.mock('../../../hooks/Chats/useShowNewCommentsBubbleInBoard', () => jest.fn())

const projectId = 'project-1'

const renderProjectData = notificationData => {
    useSelector.mockImplementation(selector => selector({ smallScreenNavigation: false }))
    useShowNewCommentsBubbleInBoard.mockReturnValue({
        showFollowedBubble: false,
        showUnfollowedBubble: false,
        totalFollowed: 0,
        totalUnfollowed: 0,
        ...notificationData,
    })

    return renderer.create(
        <ProjectAndUserData projectId={projectId} projectIndex={0} userInHeader={{ uid: 'user-1' }} />
    )
}

describe('ProjectAndUserData comment badges', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('keeps the red badge on a project line that is rendered for another reason', () => {
        const tree = renderProjectData({ showFollowedBubble: true, totalFollowed: 2 })
        const badge = tree.root.findByType('NotificationBubble')

        expect(badge.props).toEqual(expect.objectContaining({ amount: 2, isFollowedNotification: true, projectId }))
    })

    it('keeps the grey badge on a project line that is rendered for another reason', () => {
        const tree = renderProjectData({ showUnfollowedBubble: true, totalUnfollowed: 3 })
        const badge = tree.root.findByType('NotificationBubble')

        expect(badge.props).toEqual(expect.objectContaining({ amount: 3, projectId }))
        expect(badge.props.isFollowedNotification).toBeUndefined()
    })
})
