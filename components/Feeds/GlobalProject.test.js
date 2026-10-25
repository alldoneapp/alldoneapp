/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'

import GlobalProject from './GlobalProject'
import Backend from '../../utils/BackendBridge'
import { checkIfSelectedAllProjects } from '../SettingsView/ProjectsSettings/ProjectHelper'

const mockDispatch = jest.fn()
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch, useSelector: jest.fn() }))

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

jest.mock('../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    checkIfSelectedAllProjects: jest.fn(() => true),
}))

jest.mock('../../redux/actions', () => ({
    setAllFeeds: jest.fn((projectId, feeds) => ({ type: 'Set all feeds', projectId, feeds })),
    setFollowedFeeds: jest.fn((projectId, feeds) => ({ type: 'Set followed feeds', projectId, feeds })),
    setInPartnerFeeds: jest.fn(value => ({ type: 'Set in partner feeds', value })),
}))

jest.mock('./Utils/FeedsConstants', () => ({ FOLLOWED_TAB: 0, ALL_TAB: 1 }))
jest.mock('./Commons/ProjectLabelFeed', () => () => null)

// Captures the props GlobalProject hands to the list so the test can drive "show more".
let lastListProps = null
let listRenders = 0
jest.mock('./FeedsGlobalList', () => props => {
    lastListProps = props
    listRenders += 1
    return null
})

const PROJECT_ID = 'project-1'
const USER_ID = 'user-1'
const PROJECT = { id: PROJECT_ID, name: 'Alldone Product' }

// `followedFeedsData` / `allFeedsData` are the new-feed counters GlobalProject now selects itself
// instead of receiving the whole map as a prop.
const STATE = {
    showNewDayNotification: false,
    selectedProjectIndex: -1,
    allFeeds: { [PROJECT_ID]: [] },
    followedFeeds: { [PROJECT_ID]: [] },
    followedFeedsData: { [PROJECT_ID]: [{ id: 'feed-1' }] },
    allFeedsData: { [PROJECT_ID]: [{ id: 'feed-1' }] },
}

const renderView = (props = {}) => {
    useSelector.mockImplementation(selector => selector(STATE))
    let tree
    act(() => {
        tree = renderer.create(
            <GlobalProject
                project={PROJECT}
                feedActiveTab={0}
                updateProjectNewFeedAmount={jest.fn()}
                amountNewFeeds={0}
                globalActiveMode="historical"
                feedsUserId={USER_ID}
                projectId={PROJECT_ID}
                {...props}
            />
        )
    })
    return tree
}

describe('GlobalProject feeds subscription', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        lastListProps = null
        listRenders = 0
        checkIfSelectedAllProjects.mockReturnValue(true)
    })

    it('does not re-render its feed subtree when the page re-renders with the same props', () => {
        const props = {
            project: PROJECT,
            feedActiveTab: 0,
            updateProjectNewFeedAmount: jest.fn(),
            amountNewFeeds: 0,
            globalActiveMode: 'historical',
            feedsUserId: USER_ID,
            projectId: PROJECT_ID,
        }
        useSelector.mockImplementation(selector => selector(STATE))
        let tree
        act(() => {
            tree = renderer.create(<GlobalProject {...props} />)
        })
        const rendersAfterMount = listRenders

        // RootViewFeedsGlobalProject re-renders constantly (loggedUser, loggedUserProjects, the
        // feed counters), and one GlobalProject is mounted per project.
        act(() => {
            tree.update(<GlobalProject {...props} />)
        })

        expect(listRenders).toBe(rendersAfterMount)
    })

    it('caps the feeds listener at the 5 feeds an all-projects row displays', () => {
        renderView()

        expect(Backend.watchNewFeedsAllTabsRedux).toHaveBeenCalledTimes(1)
        // Without this third argument the listener downloads 200 documents per project per tab.
        expect(Backend.watchNewFeedsAllTabsRedux).toHaveBeenCalledWith(
            PROJECT_ID,
            USER_ID,
            5,
            expect.objectContaining({ manageLoading: true, trackConnectionHealth: true })
        )
    })

    it('caps it at the 20 feeds a single-project view displays', () => {
        checkIfSelectedAllProjects.mockReturnValue(false)

        renderView()

        expect(Backend.watchNewFeedsAllTabsRedux).toHaveBeenCalledWith(
            PROJECT_ID,
            USER_ID,
            20,
            expect.objectContaining({ manageLoading: true, trackConnectionHealth: true })
        )
    })

    it('re-subscribes with the show-more ceiling when the list asks for every feed', () => {
        renderView()
        expect(lastListProps.onRequestAllFeeds).toEqual(expect.any(Function))

        act(() => {
            lastListProps.onRequestAllFeeds()
        })

        expect(Backend.watchNewFeedsAllTabsRedux).toHaveBeenCalledTimes(2)
        expect(Backend.watchNewFeedsAllTabsRedux).toHaveBeenLastCalledWith(
            PROJECT_ID,
            USER_ID,
            99,
            expect.objectContaining({ manageLoading: true, trackConnectionHealth: true })
        )
        // The previous listener has to go, otherwise both stay live on the same project/tab.
        expect(Backend.unsubStoreFeedsTab).toHaveBeenLastCalledWith(PROJECT_ID)
    })

    it('does not re-subscribe again once it is already showing every feed', () => {
        renderView()

        act(() => {
            lastListProps.onRequestAllFeeds()
        })
        act(() => {
            lastListProps.onRequestAllFeeds()
        })

        expect(Backend.watchNewFeedsAllTabsRedux).toHaveBeenCalledTimes(2)
    })

    it('keeps background project admission out of page loading and connection health', () => {
        renderView({ trackInitialLoad: false })

        expect(Backend.watchNewFeedsAllTabsRedux).toHaveBeenCalledWith(
            PROJECT_ID,
            USER_ID,
            5,
            expect.objectContaining({ manageLoading: false, trackConnectionHealth: false })
        )
    })

    it('resets only its own project when it (re)subscribes', () => {
        renderView()

        // `setFollowedFeeds()` / `setAllFeeds()` with no project id reset the whole map, which threw
        // away every other mounted project's feeds - one GlobalProject is mounted per project.
        const resetActions = mockDispatch.mock.calls[0][0]
        expect(resetActions).toEqual([
            expect.objectContaining({ type: 'Set followed feeds', projectId: PROJECT_ID }),
            expect.objectContaining({ type: 'Set all feeds', projectId: PROJECT_ID }),
        ])
    })

    it('keeps the loaded feeds on screen while the wider listener is being set up', () => {
        renderView()
        mockDispatch.mockClear()

        act(() => {
            lastListProps.onRequestAllFeeds()
        })

        // Expanding must not clear the store: the rows already rendered stay until more arrive.
        expect(mockDispatch).not.toHaveBeenCalled()
    })

    it('unsubscribes and clears only its own project on unmount', () => {
        const tree = renderView()
        mockDispatch.mockClear()

        act(() => {
            tree.unmount()
        })

        expect(Backend.unsubStoreFeedsTab).toHaveBeenLastCalledWith(PROJECT_ID)
        const cleanupActions = mockDispatch.mock.calls[mockDispatch.mock.calls.length - 1][0]
        expect(cleanupActions[0]).toEqual(expect.objectContaining({ projectId: PROJECT_ID }))
        expect(cleanupActions[1]).toEqual(expect.objectContaining({ projectId: PROJECT_ID }))
    })
})
