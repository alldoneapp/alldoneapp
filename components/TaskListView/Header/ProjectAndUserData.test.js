/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer from 'react-test-renderer'
import { useSelector } from 'react-redux'

import ProjectAndUserData from './ProjectAndUserData'
import useShowNewCommentsBubbleInBoard from '../../../hooks/Chats/useShowNewCommentsBubbleInBoard'
import useEmailLabelGroups from '../EmailLine/useEmailLabelGroups'

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
jest.mock('../EmailLine/EmailLabelChip', () => 'EmailLabelChip')
jest.mock('../EmailLine/useEmailLabelGroups', () => jest.fn())
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

describe('ProjectAndUserData email pill (AT-3110)', () => {
    it('does not show the email pill on a project header; messages are reached through Chats', () => {
        const tree = renderProjectData({})

        expect(tree.root.findAllByType('EmailLabelChip')).toHaveLength(0)
        expect(useEmailLabelGroups).not.toHaveBeenCalled()
        expect(tree.root.findAllByType('ProjectLine')).toHaveLength(1)
        expect(tree.root.findAllByType('UserLine')).toHaveLength(1)
    })
})

describe('ProjectAndUserData centred title (AT-3132)', () => {
    const render = centered => {
        useSelector.mockImplementation(selector => selector({ smallScreenNavigation: false }))
        useShowNewCommentsBubbleInBoard.mockReturnValue({
            showFollowedBubble: false,
            showUnfollowedBubble: false,
            totalFollowed: 0,
            totalUnfollowed: 0,
        })
        return renderer.create(
            <ProjectAndUserData
                projectId={projectId}
                projectIndex={0}
                userInHeader={{ uid: 'user-1' }}
                centered={centered}
            />
        )
    }
    const container = tree =>
        tree.root.findAll(node => node.props.testID === 'project-and-user-data' && node.props.style, {
            deep: false,
        })[0]
    const flat = node => Object.assign({}, ...[].concat(node.props.style).filter(Boolean))

    it('centres the project and user names, without the invisible placeholder that would offset them', () => {
        const tree = render(true)

        expect(flat(container(tree)).justifyContent).toBe('center')
        expect(tree.root.findAllByType('Icon')).toHaveLength(0)
        expect(tree.root.findAllByType('ProjectLine')).toHaveLength(1)
        expect(tree.root.findAllByType('UserLine')).toHaveLength(1)
    })

    it('leaves the per-project lines as they were', () => {
        const tree = render(false)

        expect(flat(container(tree)).justifyContent).toBe('flex-start')
        expect(tree.root.findAllByType('Icon')).toHaveLength(1)
    })
})
