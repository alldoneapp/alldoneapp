const mockQueueMove = jest.fn(async () => ({ queued: true }))
const mockWaitForMove = jest.fn(async () => ({ id: 'contact-1', displayName: 'Erik Bartel' }))

jest.mock('firebase/compat/app', () => ({
    __esModule: true,
    default: {},
}))
jest.mock('../firestore', () => ({
    getDb: jest.fn(),
}))
jest.mock('../projectMoves', () => ({
    queueObjectProjectMove: (...args) => mockQueueMove(...args),
    waitForProjectMoveCompletion: (...args) => mockWaitForMove(...args),
}))
jest.mock('./contactUpdates', () => ({}))
jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: {
        getState: () => ({ loggedUser: { uid: 'user-1' }, route: '' }),
    },
}))
jest.mock('../../../functions/BatchWrapper/batchWrapper', () => ({ BatchWrapper: jest.fn() }))
jest.mock('../../../components/Followers/FollowerConstants', () => ({}))
jest.mock('../../../components/TaskListView/Utils/TasksHelper', () => ({
    __esModule: true,
    default: {},
}))
jest.mock('../../../redux/actions', () => ({}))
jest.mock('../../../utils/NavigationService', () => ({
    __esModule: true,
    default: {},
}))
jest.mock('../../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {},
}))
jest.mock('../../../utils/TabNavigationConstants', () => ({}))
jest.mock('../Notes/notesFirestore', () => ({}))
jest.mock('../Chats/chatsFirestore', () => ({}))
jest.mock('../../../components/Feeds/Utils/FeedsConstants', () => ({ FEED_PUBLIC_FOR_ALL: 0 }))

const { setContactProject } = require('./contactsFirestore')

describe('setContactProject', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('queues the cloud move and waits for its completed contact', async () => {
        const moved = await setContactProject({ id: 'project-a' }, { id: 'project-b' }, { uid: 'contact-1' })

        expect(mockQueueMove).toHaveBeenCalledWith('project-a', 'project-b', 'contact', 'contact-1')
        expect(mockWaitForMove).toHaveBeenCalledWith('project-a', 'project-b', 'contact', 'contact-1')
        expect(moved).toEqual({ id: 'contact-1', displayName: 'Erik Bartel' })
    })
})
