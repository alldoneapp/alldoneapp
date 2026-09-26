/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'

import FeedsGlobalList from './FeedsGlobalList'
import { getInitialData, processInitialFeeds } from './Utils/FeedsHelper'
import { ALL_TAB, FOLLOWED_TAB } from './Utils/FeedsConstants'

jest.mock('react-redux', () => ({ useDispatch: () => jest.fn(), useSelector: jest.fn() }))

const HISTORICAL_MODE = 'historical'

jest.mock('./Utils/FeedsHelper', () => {
    const HISTORICAL = 'historical'
    return {
        LOADING_MODE: 'loading',
        HISTORICAL_MODE: HISTORICAL,
        NEW_FEEDS_MODE: 'new',
        MAX_FEEDS_AMOUNT_TO_DISPLAY: 99,
        getLimitFeedAmountToDisplay: jest.fn(() => 5),
        getInitialData: jest.fn((tab, counterNewFeedsData, followedFeeds, allFeeds) => ({
            mode: HISTORICAL,
            feedsToProcess: (tab === 0 ? followedFeeds : allFeeds).slice(0, 5),
        })),
        // Stands in for the real async grouping: records the feeds it was handed and mirrors the
        // one state update the component's own logic depends on.
        processInitialFeeds: jest.fn(
            (mode, projectId, tab, feeds, setFeedsByDate, setFeedsOrderedArray, setDisplayedFeedsOrdered) => {
                setFeedsByDate({})
                setFeedsOrderedArray([])
                setDisplayedFeedsOrdered(feeds)
            }
        ),
        mergeFeedsInFeedsByDate: jest.fn(),
        mergeLocalFeedInFeedsByDate: jest.fn(),
        removedCommentFeedFromFeedsByDate: jest.fn(),
        removeFeedFromFeedsByDate: jest.fn(),
        removeFeedObjectFromFeedsByDate: jest.fn(),
        updateFeedsState: jest.fn(),
    }
})

jest.mock('./Utils/HelperFunctions', () => ({ UNFOLLOWED_TYPES: [] }))
jest.mock('./FeedsList', () => () => null)

const mockShowMoreProps = []
jest.mock('./Commons/ShowMoreButton', () => props => {
    mockShowMoreProps.push(props)
    return null
})

const PROJECT_ID = 'project-1'
const makeFeeds = amount => Array.from({ length: amount }, (_, index) => ({ id: `feed-${index}` }))

const renderList = (allFeeds, extraProps = {}) => {
    useSelector.mockImplementation(selector => selector({ newLocalFeedData: null }))
    let tree
    act(() => {
        tree = renderer.create(
            <FeedsGlobalList
                projectId={PROJECT_ID}
                currentDateFormated="07082026"
                feedViewData={{ type: 'globalProject' }}
                feedActiveTab={ALL_TAB}
                updateProjectNewFeedAmount={jest.fn()}
                counterNewFeedsData={[]}
                followedFeedsData={undefined}
                allFeeds={allFeeds}
                followedFeeds={[]}
                {...extraProps}
            />
        )
    })
    return tree
}

const renderProps = (overrides = {}) => (
    <FeedsGlobalList
        projectId={PROJECT_ID}
        currentDateFormated="07082026"
        feedViewData={{ type: 'globalProject' }}
        feedActiveTab={ALL_TAB}
        updateProjectNewFeedAmount={jest.fn()}
        counterNewFeedsData={[]}
        followedFeedsData={undefined}
        allFeeds={[]}
        followedFeeds={[]}
        {...overrides}
    />
)

const pressShowMore = () => {
    const expandButton = mockShowMoreProps.filter(props => props.forExpand).pop()
    expect(expandButton).toBeDefined()
    act(() => {
        expandButton.onPress()
    })
}

describe('FeedsGlobalList "show more" with a capped listener', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockShowMoreProps.length = 0
    })

    it('asks the project for every feed when the list is expanded', () => {
        const onRequestAllFeeds = jest.fn()
        renderList(makeFeeds(5), { onRequestAllFeeds })

        pressShowMore()

        // The listener only holds the first page, so the extra feeds must be requested.
        expect(onRequestAllFeeds).toHaveBeenCalledTimes(1)
    })

    it('renders the extra feeds once the widened listener delivers them', () => {
        const onRequestAllFeeds = jest.fn()
        const tree = renderList(makeFeeds(5), { onRequestAllFeeds })

        pressShowMore()
        expect(processInitialFeeds).toHaveBeenLastCalledWith(
            HISTORICAL_MODE,
            PROJECT_ID,
            ALL_TAB,
            expect.arrayContaining([expect.objectContaining({ id: 'feed-4' })]),
            ...Array(5).fill(expect.anything())
        )
        expect(processInitialFeeds.mock.calls[processInitialFeeds.mock.calls.length - 1][3]).toHaveLength(5)

        // The wider snapshot lands.
        act(() => {
            tree.update(renderProps({ allFeeds: makeFeeds(99), onRequestAllFeeds }))
        })

        // Without the top-up effect the expanded list would stay stuck on the first 5 feeds.
        expect(processInitialFeeds.mock.calls[processInitialFeeds.mock.calls.length - 1][3]).toHaveLength(99)
    })

    it('does not re-process anything before the list is expanded', () => {
        const tree = renderList(makeFeeds(5), { onRequestAllFeeds: jest.fn() })
        const callsAfterMount = processInitialFeeds.mock.calls.length

        act(() => {
            tree.update(renderProps({ allFeeds: makeFeeds(99) }))
        })

        expect(processInitialFeeds.mock.calls.length).toBe(callsAfterMount)
    })

    it('stops topping the list up after it is collapsed again', () => {
        const onRequestAllFeeds = jest.fn()
        const tree = renderList(makeFeeds(5), { onRequestAllFeeds })

        pressShowMore()
        // The widened listener delivers, so the list now holds 99 feeds and can be collapsed.
        act(() => {
            tree.update(renderProps({ allFeeds: makeFeeds(99), onRequestAllFeeds }))
        })

        const collapseButton = mockShowMoreProps.filter(props => !props.forExpand).pop()
        expect(collapseButton).toBeDefined()
        act(() => {
            collapseButton.onPress()
        })
        const callsAfterCollapse = processInitialFeeds.mock.calls.length

        act(() => {
            tree.update(renderProps({ allFeeds: makeFeeds(99), onRequestAllFeeds }))
        })

        // A snapshot arriving after "show less" must not silently re-expand the list.
        expect(processInitialFeeds.mock.calls.length).toBe(callsAfterCollapse)
    })

    it('still works when no expansion callback is supplied', () => {
        renderList(makeFeeds(5))

        expect(() => pressShowMore()).not.toThrow()
    })

    it('shows the first page from the capped listener exactly as before', () => {
        renderList(makeFeeds(5), { onRequestAllFeeds: jest.fn() })

        expect(getInitialData).toHaveBeenCalled()
        expect(processInitialFeeds.mock.calls[0][0]).toBe(HISTORICAL_MODE)
        expect(processInitialFeeds.mock.calls[0][3]).toHaveLength(5)
    })

    it('renders the active tab without waiting for the inactive subscription', () => {
        renderList(undefined, {
            feedActiveTab: FOLLOWED_TAB,
            followedFeeds: makeFeeds(2),
        })

        expect(getInitialData).toHaveBeenCalledWith(FOLLOWED_TAB, [], makeFeeds(2), undefined)
        expect(processInitialFeeds.mock.calls[0][3]).toHaveLength(2)
    })
})
