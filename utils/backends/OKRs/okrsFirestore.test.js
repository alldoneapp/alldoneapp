const mockDispatch = jest.fn()
const mockGetState = jest.fn(() => ({
    loggedUser: { uid: 'user-1', isAnonymous: false },
}))
const mockSetOKRsInProjectInTasks = jest.fn((projectId, okrs) => ({ type: 'SET_OKRS', projectId, okrs }))
const mockScheduleTaskColdStartCachePersist = jest.fn()
let mockSnapshotHandler

const mockQuery = {
    where: jest.fn(() => mockQuery),
    onSnapshot: jest.fn(handler => {
        mockSnapshotHandler = handler
        return jest.fn()
    }),
}

jest.mock('../firestore', () => ({
    getDb: jest.fn(() => ({ collection: jest.fn(() => mockQuery) })),
    getId: jest.fn(),
    globalWatcherUnsub: {},
}))
jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: { dispatch: (...args) => mockDispatch(...args), getState: mockGetState },
}))
jest.mock('../../../redux/actions', () => ({
    setOKRsInProjectInTasks: (...args) => mockSetOKRsInProjectInTasks(...args),
}))
jest.mock('../../InitialLoad/taskColdStartCache', () => ({
    scheduleTaskColdStartCachePersist: (...args) => mockScheduleTaskColdStartCachePersist(...args),
}))
jest.mock('../../../components/TaskListView/OKRs/okrHelper', () => ({
    OKR_TYPE_MANUAL: 'manual',
    OKR_TYPE_TIME_LOGGED_REVENUE: 'time_logged_revenue',
    OKR_STATUS_ACTIVE: 'active',
    buildOkrRecapChatId: jest.fn(),
    canUserSeeOkr: jest.fn(() => true),
    calculateOkrProgress: jest.fn(() => 0.5),
    getOkrIsPublicFor: jest.fn(() => ['all']),
    isOkrPrivate: jest.fn(() => false),
    getOkrPeriodForCadence: jest.fn(),
    normalizeOkrType: jest.fn(type => type || 'manual'),
    normalizeOkrNumber: jest.fn(value => Number(value) || 0),
}))
jest.mock('../Chats/chatsFirestore', () => ({ getChatMeta: jest.fn() }))
jest.mock('../../../components/Feeds/Utils/FeedsConstants', () => ({ FEED_PUBLIC_FOR_ALL: 'all' }))

const { watchProjectOKRs } = require('./okrsFirestore')

describe('watchProjectOKRs cold-start projection', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockSnapshotHandler = null
    })

    it('persists the normalized live OKR array for the next cold start', () => {
        watchProjectOKRs('project-1', 'user-1', 'watcher-1')

        mockSnapshotHandler({
            forEach: callback =>
                callback({
                    id: 'okr-1',
                    data: () => ({
                        id: 'okr-1',
                        label: 'Grow revenue',
                        currentValue: 5,
                        targetValue: 10,
                        ownerId: 'user-1',
                        projectId: 'project-1',
                    }),
                }),
        })

        expect(mockSetOKRsInProjectInTasks).toHaveBeenCalledWith(
            'project-1',
            expect.arrayContaining([expect.objectContaining({ id: 'okr-1', label: 'Grow revenue' })])
        )
        expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_OKRS' }))
        expect(mockScheduleTaskColdStartCachePersist).toHaveBeenCalledWith(mockGetState)
    })
})
