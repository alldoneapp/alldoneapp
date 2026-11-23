import React from 'react'
import renderer, { act } from 'react-test-renderer'

let mockUid = 'me'
jest.mock('react-redux', () => ({ useSelector: selector => selector({ loggedUser: { uid: mockUid } }) }))
jest.mock('../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../utils/meetingReview/meetingReviewBackend', () => ({
    getMeetingReviewDocId: id => id,
    watchMeetingReviewsInRange: jest.fn(() => () => {}),
    watchMeetingSeriesCategories: jest.fn(() => () => {}),
    watchMeetingCategoryRules: jest.fn(() => () => {}),
}))

import MeetingReviewChip from './MeetingReviewChip'
import {
    getMeetingReviewState,
    resetMeetingReviewStoreForTests,
    setMeetingReviewState,
} from '../../utils/meetingReview/meetingReviewStore'

const task = {
    id: 'evt',
    userId: 'me',
    done: true,
    name: 'Weekly Sync',
    calendarData: { recurringEventId: 's1', startMs: 1000, endMs: 3601000, attendeeCount: 6 },
}

const chipText = tree => {
    const texts = tree.root.findAll(
        node => node.type === 'Text' || (node.props && typeof node.props.children === 'string')
    )
    return texts
        .map(node => node.props.children)
        .filter(child => typeof child === 'string')
        .join('|')
}

const render = props => {
    let tree
    act(() => {
        tree = renderer.create(<MeetingReviewChip task={task} projectId="p1" {...props} />)
    })
    return tree
}

beforeEach(() => {
    mockUid = 'me'
    resetMeetingReviewStoreForTests()
})

describe('MeetingReviewChip', () => {
    it('unrated with a suggestion: "Category? · ○"', () => {
        expect(chipText(render())).toContain('Meeting category status? · ○')
    })

    it('rated and confirmed: "Category · 👎"', () => {
        setMeetingReviewState({
            reviews: {
                evt: { reviewStatus: 'rated', usefulness: 'not_helpful', category: 'status', categorySource: 'user' },
            },
        })
        expect(chipText(render())).toContain('Meeting category status · 👎')
    })

    it('not attended', () => {
        setMeetingReviewState({ reviews: { evt: { attendance: 'not_attended' } } })
        expect(chipText(render())).toContain('Meeting not attended short')
    })

    it('is hidden for open tasks (E4) and for other members of a shared project (private)', () => {
        expect(render({ task: { ...task, done: false } }).toJSON()).toBeNull()
        mockUid = 'colleague'
        expect(render().toJSON()).toBeNull()
    })

    it('opens the sheet in edit mode', () => {
        const tree = render()
        act(() => tree.root.findByProps({ testID: 'meeting-review-chip' }).props.onPress())
        expect(getMeetingReviewState().queue[0]).toMatchObject({ isEdit: true, projectId: 'p1' })
    })
})
