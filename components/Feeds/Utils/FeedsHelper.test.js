import Backend from '../../../utils/BackendBridge'
import { ALL_TAB } from './FeedsConstants'
import { NEW_FEEDS_MODE, processInitialFeeds } from './FeedsHelper'

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
