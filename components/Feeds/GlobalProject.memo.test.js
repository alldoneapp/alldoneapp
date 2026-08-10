/**
 * @jest-environment jsdom
 */

// GlobalProject is memoized so one re-render of the Updates page does not re-render every project's
// feed subtree. That is only safe because the component selects its own new-feed counters from the
// store: `followedFeedsData` / `allFeedsData` are written by mutating the map in place, so the map
// itself never changes identity and passing it as a prop would make React.memo swallow every
// counter update. This suite runs against a real store to pin both halves of that.

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Provider } from 'react-redux'
import { createStore } from 'redux'
import { reduxBatch } from '@manaflair/redux-batch'

import GlobalProject from './GlobalProject'

jest.mock('../../utils/BackendBridge', () => ({
    __esModule: true,
    default: { watchNewFeedsAllTabsRedux: jest.fn(), unsubStoreFeedsTab: jest.fn() },
}))

jest.mock('./Utils/FeedsHelper', () => ({
    LOADING_MODE: 'loading',
    HISTORICAL_MODE: 'historical',
    NEW_FEEDS_MODE: 'new',
    ALL_PROJECTS_FEEDS_AMOUNT_TO_DISPLAY: 5,
    STANDARD_FEEDS_AMOUNT_TO_DISPLAY: 20,
    MAX_FEEDS_AMOUNT_TO_DISPLAY: 99,
}))

jest.mock('./Utils/FeedsConstants', () => ({ FOLLOWED_TAB: 0, ALL_TAB: 1 }))
jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({ checkIfSelectedAllProjects: () => true }))
jest.mock('../../redux/actions', () => ({
    setAllFeeds: (projectId, feeds) => ({ type: 'noop', projectId, feeds }),
    setFollowedFeeds: (projectId, feeds) => ({ type: 'noop', projectId, feeds }),
    setInPartnerFeeds: value => ({ type: 'noop', value }),
}))
jest.mock('./Commons/ProjectLabelFeed', () => () => null)

const mockListRenders = []
jest.mock('./FeedsGlobalList', () => props => {
    mockListRenders.push(props)
    return null
})

const PROJECT_ID = 'project-1'
const PROJECT = { id: PROJECT_ID, name: 'Alldone Product' }
const FIRST_COUNTER = [{ id: 'feed-1' }]

// The map is deliberately shared and mutated, exactly the way InitLoadView writes it.
const followedFeedsData = { [PROJECT_ID]: FIRST_COUNTER }

const initialState = {
    showNewDayNotification: false,
    selectedProjectIndex: -1,
    allFeeds: { [PROJECT_ID]: [] },
    followedFeeds: { [PROJECT_ID]: [] },
    followedFeedsData,
    allFeedsData: {},
    unrelated: 0,
}

const reducer = (state = initialState, action) => {
    if (action.type === 'Set followed feeds data') {
        // In-place mutation of the map, then a new root state object - what InitLoadView does.
        followedFeedsData[PROJECT_ID] = action.counters
        return { ...state, followedFeedsData }
    }
    if (action.type === 'Unrelated change') return { ...state, unrelated: state.unrelated + 1 }
    return state
}

const renderView = store => {
    let tree
    act(() => {
        tree = renderer.create(
            <Provider store={store}>
                <GlobalProject
                    project={PROJECT}
                    feedActiveTab={0}
                    updateProjectNewFeedAmount={jest.fn()}
                    amountNewFeeds={0}
                    globalActiveMode="historical"
                    feedsUserId="user-1"
                    projectId={PROJECT_ID}
                />
            </Provider>
        )
    })
    return tree
}

describe('GlobalProject memoization', () => {
    beforeEach(() => {
        mockListRenders.length = 0
        followedFeedsData[PROJECT_ID] = FIRST_COUNTER
    })

    it('delivers a new-feed counter update even though the counters map is mutated in place', () => {
        const store = createStore(reducer, reduxBatch)
        renderView(store)

        expect(mockListRenders[mockListRenders.length - 1].counterNewFeedsData).toBe(FIRST_COUNTER)

        const nextCounter = [{ id: 'feed-1' }, { id: 'feed-2' }]
        act(() => {
            store.dispatch({ type: 'Set followed feeds data', counters: nextCounter })
        })

        // If the map were still a prop, React.memo would compare the same (mutated) object with
        // itself and this update would never reach the list.
        expect(mockListRenders[mockListRenders.length - 1].counterNewFeedsData).toBe(nextCounter)
    })

    it('does not re-render for store changes it does not read', () => {
        const store = createStore(reducer, reduxBatch)
        renderView(store)
        const rendersAfterMount = mockListRenders.length

        act(() => {
            store.dispatch({ type: 'Unrelated change' })
        })

        expect(mockListRenders.length).toBe(rendersAfterMount)
    })
})
