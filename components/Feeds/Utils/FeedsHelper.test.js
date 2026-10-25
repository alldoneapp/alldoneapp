import Backend from '../../../utils/BackendBridge'
import { ALL_TAB } from './FeedsConstants'
import { mergeFeedsInFeedsByDate, NEW_FEEDS_MODE, processInitialFeeds } from './FeedsHelper'

jest.mock('../../../utils/BackendBridge', () => ({
    __esModule: true,
    default: { getFeedObject: jest.fn(), resetAllNewFeeds: jest.fn() },
}))
jest.mock('../../FeedView/Utils/FeedHelper', () => ({
    __esModule: true,
    default: { isPrivateTopic: () => false },
}))
jest.mock('./HelperFunctions', () => ({ CREATION_TYPES: [], FOLLOWED_TYPES: [] }))
jest.mock('../../../utils/HelperFunctions', () => ({ chronoKeysOrderDesc: (a, b) => b.localeCompare(a) }))
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({ checkIfSelectedAllProjects: () => true }))
jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: { getState: () => ({ selectedProjectIndex: -1, currentUser: { uid: 'user-1' } }) },
}))

const projectId = 'project-1'
const feed = {
    id: 'feed-1',
    objectId: 'task-1',
    lastChangeDate: 1790406366979,
    type: 1,
}

const process = () =>
    processInitialFeeds(
        NEW_FEEDS_MODE,
        projectId,
        ALL_TAB,
        [{ ...feed }],
        jest.fn(),
        jest.fn(),
        jest.fn(),
        [],
        jest.fn()
    )

describe('initial unread Updates feed', () => {
    beforeEach(() => jest.clearAllMocks())

    it('keeps the unread counter when the object read fails before access projection', async () => {
        Backend.getFeedObject.mockRejectedValueOnce(new Error('permission-denied'))

        await expect(process()).rejects.toThrow('permission-denied')
        expect(Backend.resetAllNewFeeds).not.toHaveBeenCalled()
    })

    it('clears the counter only after the object can be displayed', async () => {
        Backend.getFeedObject.mockResolvedValueOnce({ id: 'task-1', type: 'task', isPublicFor: [0] })

        await process()
        expect(Backend.resetAllNewFeeds).toHaveBeenCalledWith(projectId, ALL_TAB)
    })

    it('reads the object from the day the unread counter recorded, not the local day', async () => {
        // Filed by a Cloud Function at 22:01 UTC on 27.09 - already 28.09 in Berlin.
        Backend.getFeedObject.mockResolvedValueOnce({ id: 'task-1', type: 'task', isPublicFor: [0] })

        await processInitialFeeds(
            NEW_FEEDS_MODE,
            projectId,
            ALL_TAB,
            [{ ...feed, lastChangeDate: 1790546467082, dateFormated: '27092026' }],
            jest.fn(),
            jest.fn(),
            jest.fn(),
            [],
            jest.fn()
        )
        expect(Backend.getFeedObject).toHaveBeenCalledWith(projectId, '27092026', 'task-1', 1, 1790546467082)
    })

    it('does not clear the counter after the user leaves the tab during the read', async () => {
        Backend.getFeedObject.mockResolvedValueOnce({ id: 'task-1', type: 'task', isPublicFor: [0] })

        await processInitialFeeds(
            NEW_FEEDS_MODE,
            projectId,
            ALL_TAB,
            [{ ...feed }],
            jest.fn(),
            jest.fn(),
            jest.fn(),
            [],
            jest.fn(),
            () => false
        )
        expect(Backend.resetAllNewFeeds).not.toHaveBeenCalled()
    })
})

describe('Updates rows whose object cannot be shown', () => {
    beforeEach(() => jest.clearAllMocks())

    const secondFeed = { id: 'feed-2', objectId: 'task-2', lastChangeDate: 1790406366000, type: 1 }
    const readable = { id: 'task-2', type: 'task', isPublicFor: [0] }

    const processBoth = options => {
        const setDisplayedFeedsOrdered = jest.fn()
        const setFeedsOrderedArray = jest.fn()
        const run = processInitialFeeds(
            NEW_FEEDS_MODE,
            projectId,
            ALL_TAB,
            [{ ...feed }, { ...secondFeed }],
            jest.fn(),
            setFeedsOrderedArray,
            setDisplayedFeedsOrdered,
            [],
            jest.fn(),
            undefined,
            options
        )
        return { run, setDisplayedFeedsOrdered, setFeedsOrderedArray }
    }

    it('skips an object that no longer exists and still clears the counter', async () => {
        Backend.getFeedObject.mockImplementation(async (_, __, objectId) => (objectId === 'task-2' ? readable : null))

        const { run, setDisplayedFeedsOrdered, setFeedsOrderedArray } = processBoth()
        await run

        expect(setDisplayedFeedsOrdered.mock.calls[0][0].map(row => row.id)).toEqual(['feed-2'])
        const renderedObjects = setFeedsOrderedArray.mock.calls[0][0].flatMap(date => date.feedObjects)
        expect(renderedObjects.map(row => row.object.id)).toEqual(['task-2'])
        expect(Backend.resetAllNewFeeds).toHaveBeenCalledWith(projectId, ALL_TAB)
    })

    it('by default still waits for an unreadable object', async () => {
        Backend.getFeedObject.mockImplementation(async (_, __, objectId) => {
            if (objectId === 'task-1') throw new Error('permission-denied')
            return readable
        })

        await expect(processBoth().run).rejects.toThrow('permission-denied')
        expect(Backend.resetAllNewFeeds).not.toHaveBeenCalled()
    })

    it('drops an unreadable object once the caller gives up on it', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        Backend.getFeedObject.mockImplementation(async (_, __, objectId) => {
            if (objectId === 'task-1') throw new Error('permission-denied')
            return readable
        })

        try {
            const { run, setDisplayedFeedsOrdered } = processBoth({ dropUnreadable: true })
            await run

            expect(setDisplayedFeedsOrdered.mock.calls[0][0].map(row => row.id)).toEqual(['feed-2'])
            expect(Backend.resetAllNewFeeds).toHaveBeenCalledWith(projectId, ALL_TAB)
        } finally {
            warn.mockRestore()
        }
    })

    it('merges only the new feeds whose object can be shown', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        Backend.getFeedObject.mockImplementation(async (_, __, objectId) => {
            if (objectId === 'task-1') throw new Error('permission-denied')
            return readable
        })
        const setDisplayedFeedsOrdered = jest.fn()

        try {
            await mergeFeedsInFeedsByDate(
                projectId,
                {},
                [],
                5,
                jest.fn(),
                setDisplayedFeedsOrdered,
                jest.fn(),
                2,
                2,
                [{ ...feed }, { ...secondFeed }],
                true,
                ALL_TAB
            )

            expect(setDisplayedFeedsOrdered.mock.calls[0][0].map(row => row.id)).toEqual(['feed-2'])
        } finally {
            warn.mockRestore()
        }
    })
})
