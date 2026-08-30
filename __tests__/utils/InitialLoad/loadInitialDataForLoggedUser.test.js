/**
 * Regression tests for the reported incident:
 *   "Error during login: TypeError: Cannot set properties of null (setting 'index')"
 * followed by an automatic logout.
 *
 * A project entry whose document could not be read (`project: null`) must not abort the login.
 */

const mockDispatch = jest.fn()
const mockDeferredStartupCallbacks = []
const mockScheduleAfterInitialTaskData = jest.fn((callback, options) => {
    mockDeferredStartupCallbacks.push({ callback, options })
    return jest.fn()
})
const mockState = {
    loggedUser: { uid: 'user-1', projectIds: ['p1', 'p2'], dateFormat: 'DD/MM/YYYY', language: 'en' },
    initialUrl: '/',
}

jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: {
        getState: () => mockState,
        dispatch: (...args) => mockDispatch(...args),
    },
}))

jest.mock('../../../utils/InitialLoad/startupTaskReadiness', () => ({
    scheduleAfterInitialTaskData: (...args) => mockScheduleAfterInitialTaskData(...args),
}))

const mockReadTaskColdStartCache = jest.fn(() => Promise.resolve(null))
const mockGetRestorableTaskColdStartSnapshot = jest.fn(() => null)
jest.mock('../../../utils/InitialLoad/taskColdStartCache', () => ({
    readTaskColdStartCache: (...args) => mockReadTaskColdStartCache(...args),
    getRestorableTaskColdStartSnapshot: (...args) => mockGetRestorableTaskColdStartSnapshot(...args),
}))

const mockSetCachedGlobalData = jest.fn()
const mockSetCachedUserData = jest.fn()
let mockCachedUserData = null
let mockCachedGlobalData = null
jest.mock('../../../utils/UserDataCache', () => ({
    __esModule: true,
    default: {
        getCachedUserData: () => mockCachedUserData,
        setCachedUserData: (...args) => mockSetCachedUserData(...args),
        getCachedGlobalData: () => mockCachedGlobalData,
        setCachedGlobalData: (...args) => mockSetCachedGlobalData(...args),
    },
}))

const mockGetProjectData = jest.fn()
jest.mock('../../../utils/backends/firestore', () => ({
    initFCMonLoad: jest.fn(),
    initGoogleTagManager: jest.fn(),
    proccessAssistantDialyTopicIfNeeded: jest.fn(),
    resetTimesDoneInExpectedDayPropertyInTasksIfNeeded: jest.fn(() => Promise.resolve()),
    unwatch: jest.fn(),
    updateLastLoggedUserDate: jest.fn(),
    watchForceReload: jest.fn(),
    // The loader consumes the result shape; mockGetProjectData keeps returning a plain
    // project-or-null (or a { project, missingFromCache } object for the transient-miss tests).
    getProjectDataResult: (...args) =>
        mockGetProjectData(...args).then(result =>
            result && typeof result === 'object' && 'missingFromCache' in result
                ? result
                : { project: result, missingFromCache: false }
        ),
}))

jest.mock('../../../utils/backends/Users/usersFirestore', () => ({
    fetchUserDataResult: jest.fn(),
    getUserData: jest.fn(),
    updateUserDataDirectly: jest.fn(),
    getProjectUsers: jest.fn(() => Promise.resolve([])),
}))
jest.mock('../../../utils/backends/Contacts/contactsFirestore', () => ({
    getProjectContacts: jest.fn(() => Promise.resolve([])),
}))
jest.mock('../../../utils/backends/Workstreams/workstreamsFirestore', () => ({
    getProjectWorkstreams: jest.fn(() => Promise.resolve([])),
}))
jest.mock('../../../utils/backends/Assistants/assistantsFirestore', () => ({
    getProjectAssistants: jest.fn(() => Promise.resolve([])),
}))

const mockSetProjectsInitialData = jest.fn((...args) => ({ type: 'SET_PROJECTS_INITIAL_DATA', args }))
jest.mock('../../../redux/actions', () => ({
    initLogInForLoggedUser: jest.fn(payload => ({ type: 'INIT_LOGIN', payload })),
    setDoneMilestonesInProjectInTasks: jest.fn((projectId, value) => ({
        type: 'SET_DONE_MILESTONES',
        projectId,
        value,
    })),
    setGoalsInProjectInTasks: jest.fn((projectId, value) => ({ type: 'SET_GOALS', projectId, value })),
    setOpenMilestonesInProjectInTasks: jest.fn((projectId, value) => ({
        type: 'SET_OPEN_MILESTONES',
        projectId,
        value,
    })),
    setOpenSubtasksMap: jest.fn((projectId, value) => ({ type: 'SET_OPEN_SUBTASKS_MAP', projectId, value })),
    setOpenTasksMap: jest.fn((projectId, value) => ({ type: 'SET_OPEN_TASKS_MAP', projectId, value })),
    setProjectsInitialData: (...args) => mockSetProjectsInitialData(...args),
    updateFilteredOpenTasks: jest.fn((instanceKey, value) => ({
        type: 'UPDATE_FILTERED_OPEN_TASKS',
        instanceKey,
        value,
    })),
    updateLoadingStep: jest.fn((step, message) => ({ type: 'UPDATE_LOADING_STEP', step, message })),
    updateOpenTasks: jest.fn((instanceKey, value) => ({ type: 'UPDATE_OPEN_TASKS', instanceKey, value })),
    updateSubtaskByTask: jest.fn((instanceKey, value) => ({ type: 'UPDATE_SUBTASK_BY_TASK', instanceKey, value })),
    updateThereAreHiddenNotMainTasks: jest.fn((instanceKey, value) => ({
        type: 'UPDATE_HIDDEN_TASKS',
        instanceKey,
        value,
    })),
    updateThereAreNotTasksInFirstDay: jest.fn((instanceKey, value) => ({
        type: 'UPDATE_EMPTY_FIRST_DAY',
        instanceKey,
        value,
    })),
    storeLoggedUser: jest.fn(user => ({ type: 'STORE_LOGGED_USER', user })),
}))

jest.mock('../../../utils/InitialLoad/initialLoadHelper', () => ({
    convertAnonymousProjectsIntoSharedProjects: jest.fn(),
    getInitialProjectData: jest.fn(),
    handleCookies: jest.fn(),
    loadGlobalData: jest.fn(() => Promise.resolve()),
    unwatchProjectsData: jest.fn(),
    watchLoggedUserData: jest.fn(),
    watchProjectData: jest.fn(),
    watchProjectsChatNotifications: jest.fn(),
}))

jest.mock('../../../utils/FunnyLoadingMessages', () => ({ getProgressLoadingMessage: () => 'loading' }))
jest.mock('../../../utils/Geolocation/GeolocationHelper', () => ({
    getDateFormatFromCurrentLocation: jest.fn(() =>
        Promise.resolve({ dateFormat: 'DD/MM/YYYY', mondayFirstInCalendar: true })
    ),
}))
jest.mock('../../../i18n/TranslationService', () => ({ getDeviceLanguage: () => 'en' }))
jest.mock('../../../utils/Observers', () => ({ storeVersion: jest.fn() }))
jest.mock('../../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { processInactiveProjectsWhenLoginUser: jest.fn() },
}))
jest.mock('../../../URLSystem/URLTrigger', () => ({
    __esModule: true,
    default: { processUrl: jest.fn() },
}))
jest.mock('../../../utils/NavigationService', () => ({ __esModule: true, default: {} }))
jest.mock('../../../utils/backends/Premium/stripePremiumFirestore', () => ({
    checkUserPremiumStatusStripe: jest.fn(() => Promise.resolve()),
}))
jest.mock('../../../utils/analytics/analytics', () => ({ trackEvent: jest.fn() }))

const {
    CACHED_PROJECT_REFRESH_SETTLE_MS,
    CACHED_USER_REFRESH_BOOT_BUDGET_MS,
    loadGlobalDataAndGetUserResult,
    loadInitialDataForLoggedUser,
    POST_LOGIN_MAINTENANCE_SETTLE_MS,
} = require('../../../utils/InitialLoad/loggedUserHelper')
const { fetchUserDataResult } = require('../../../utils/backends/Users/usersFirestore')

const project = id => ({ id, name: `Project ${id}` })

const getProjectsInitialDataDispatch = () => {
    const call = mockSetProjectsInitialData.mock.calls[mockSetProjectsInitialData.mock.calls.length - 1]
    return { projects: call[0], projectsMap: call[1] }
}

beforeEach(() => {
    jest.clearAllMocks()
    mockDeferredStartupCallbacks.length = 0
    mockCachedUserData = null
    mockCachedGlobalData = null
    mockReadTaskColdStartCache.mockResolvedValue(null)
    mockGetRestorableTaskColdStartSnapshot.mockReturnValue(null)
    mockState.loggedUser = { uid: 'user-1', projectIds: ['p1', 'p2'], dateFormat: 'DD/MM/YYYY', language: 'en' }
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
    jest.restoreAllMocks()
})

describe('loadGlobalDataAndGetUserResult', () => {
    it('uses a current user document instead of stale cached project membership', async () => {
        mockCachedUserData = { uid: 'user-1', projectIds: ['p1'] }
        const freshUser = { uid: 'user-1', projectIds: ['p1', 'p2'] }
        fetchUserDataResult.mockResolvedValue({ user: freshUser, missing: false, error: null })

        await expect(loadGlobalDataAndGetUserResult('user-1')).resolves.toEqual({
            user: freshUser,
            missing: false,
            error: null,
        })

        expect(mockSetCachedUserData).toHaveBeenCalledWith(freshUser)
    })

    it('uses cached user data only as an offline fallback', async () => {
        const cachedUser = { uid: 'user-1', projectIds: ['p1'] }
        const offline = new Error('offline')
        mockCachedUserData = cachedUser
        fetchUserDataResult.mockResolvedValue({ user: null, missing: false, error: offline })

        await expect(loadGlobalDataAndGetUserResult('user-1')).resolves.toEqual({
            user: cachedUser,
            missing: false,
            error: null,
        })
    })

    it('does not let cached data hide a directly confirmed missing user document', async () => {
        mockCachedUserData = { uid: 'user-1', projectIds: ['p1'] }
        fetchUserDataResult.mockResolvedValue({ user: null, missing: true, error: null })

        await expect(loadGlobalDataAndGetUserResult('user-1')).resolves.toEqual({
            user: null,
            missing: true,
            error: null,
        })
    })

    it('boots from a valid cache when the authoritative user read exceeds its budget', async () => {
        jest.useFakeTimers()
        const cachedUser = { uid: 'user-1', projectIds: ['p1'] }
        const freshUser = { uid: 'user-1', projectIds: ['p1', 'p2'] }
        mockCachedUserData = cachedUser
        let resolveFreshResult
        fetchUserDataResult.mockReturnValue(
            new Promise(resolve => {
                resolveFreshResult = resolve
            })
        )

        const bootResultPromise = loadGlobalDataAndGetUserResult('user-1')
        await Promise.resolve()
        jest.advanceTimersByTime(CACHED_USER_REFRESH_BOOT_BUDGET_MS)
        const bootResult = await bootResultPromise

        expect(bootResult).toEqual(expect.objectContaining({ user: cachedUser, missing: false, error: null }))
        expect(bootResult.deferredUserResult).toBeInstanceOf(Promise)

        resolveFreshResult({ user: freshUser, missing: false, error: null })
        await expect(bootResult.deferredUserResult).resolves.toEqual({
            user: freshUser,
            missing: false,
            error: null,
        })
        expect(mockSetCachedUserData).toHaveBeenCalledWith(freshUser)
        jest.useRealTimers()
    })
})

describe('loadInitialDataForLoggedUser', () => {
    it('hydrates the render-ready task projection before routing', async () => {
        mockGetProjectData.mockImplementation(id => Promise.resolve(project(id)))
        mockReadTaskColdStartCache.mockResolvedValue({ userId: 'user-1' })
        mockGetRestorableTaskColdStartSnapshot.mockReturnValue({
            projects: {
                p1: {
                    openTasks: [['0', 1]],
                    subtaskByTask: {},
                    openTasksMap: { task: { id: 'task' } },
                    openSubtasksMap: {},
                    openMilestones: [{ id: 'open-milestone' }],
                    doneMilestones: [{ id: 'done-milestone' }],
                    goalsById: { goal: { id: 'goal' } },
                    thereAreNotTasksInFirstDay: false,
                    thereAreHiddenNotMainTasks: false,
                },
            },
        })

        await loadInitialDataForLoggedUser(mockState.loggedUser)

        expect(mockReadTaskColdStartCache).toHaveBeenCalledWith('user-1')
        expect(mockDispatch).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ type: 'UPDATE_OPEN_TASKS', instanceKey: 'p1user-1' }),
                expect.objectContaining({ type: 'UPDATE_FILTERED_OPEN_TASKS', instanceKey: 'p1user-1' }),
                expect.objectContaining({ type: 'SET_OPEN_TASKS_MAP', projectId: 'p1' }),
                expect.objectContaining({ type: 'SET_OPEN_MILESTONES', projectId: 'p1' }),
                expect.objectContaining({ type: 'SET_DONE_MILESTONES', projectId: 'p1' }),
                expect.objectContaining({ type: 'SET_GOALS', projectId: 'p1' }),
            ])
        )
    })

    it('keeps post-login Firestore maintenance out of the first task render', async () => {
        mockGetProjectData.mockImplementation(id => Promise.resolve(project(id)))
        const {
            initFCMonLoad,
            resetTimesDoneInExpectedDayPropertyInTasksIfNeeded,
            updateLastLoggedUserDate,
        } = require('../../../utils/backends/firestore')

        await loadInitialDataForLoggedUser(mockState.loggedUser)

        expect(initFCMonLoad).not.toHaveBeenCalled()
        expect(updateLastLoggedUserDate).not.toHaveBeenCalled()
        expect(resetTimesDoneInExpectedDayPropertyInTasksIfNeeded).not.toHaveBeenCalled()

        const maintenance = mockDeferredStartupCallbacks.find(
            deferred => deferred.options?.settleMs === POST_LOGIN_MAINTENANCE_SETTLE_MS
        )
        expect(maintenance).toBeDefined()
        await maintenance.callback()

        expect(initFCMonLoad).toHaveBeenCalledTimes(1)
        expect(updateLastLoggedUserDate).toHaveBeenCalledTimes(1)
        expect(resetTimesDoneInExpectedDayPropertyInTasksIfNeeded).toHaveBeenCalledTimes(1)
    })

    it('refreshes a complete project shell only after the task-first quiet window', async () => {
        mockCachedGlobalData = {
            projectIds: ['p1', 'p2'],
            projectsInitialData: [
                { projectId: 'p1', project: project('p1'), users: [], contacts: [], workstreams: [], assistants: [] },
                { projectId: 'p2', project: project('p2'), users: [], contacts: [], workstreams: [], assistants: [] },
            ],
        }
        mockGetProjectData.mockImplementation(id => Promise.resolve(project(id)))

        await loadInitialDataForLoggedUser(mockState.loggedUser)

        expect(mockGetProjectData).not.toHaveBeenCalled()
        const refresh = mockDeferredStartupCallbacks.find(
            deferred => deferred.options?.settleMs === CACHED_PROJECT_REFRESH_SETTLE_MS
        )
        expect(refresh).toBeDefined()
        await refresh.callback()
        expect(mockGetProjectData).toHaveBeenCalledTimes(2)
    })

    it('completes the login when a project document cannot be read', async () => {
        // p2 was deleted / is no longer accessible -> mockGetProjectData resolves null
        mockGetProjectData.mockImplementation(id => Promise.resolve(id === 'p1' ? project('p1') : null))

        await expect(loadInitialDataForLoggedUser(mockState.loggedUser)).resolves.toBeUndefined()

        const { projects, projectsMap } = getProjectsInitialDataDispatch()
        expect(projects.map(p => p.id)).toEqual(['p1'])
        expect(projects[0].index).toBe(0)
        expect(projectsMap.p2).toBeUndefined()
    })

    it('does not poison the startup cache with an incomplete payload', async () => {
        mockGetProjectData.mockImplementation(id => Promise.resolve(id === 'p1' ? project('p1') : null))

        await loadInitialDataForLoggedUser(mockState.loggedUser)

        expect(mockSetCachedGlobalData).not.toHaveBeenCalled()
    })

    it('caches a complete payload', async () => {
        mockGetProjectData.mockImplementation(id => Promise.resolve(project(id)))

        await loadInitialDataForLoggedUser(mockState.loggedUser)

        expect(mockSetCachedGlobalData).toHaveBeenCalledTimes(1)
        expect(mockSetCachedGlobalData.mock.calls[0][0].projectIds).toEqual(['p1', 'p2'])
    })

    it('ignores a malformed cached payload and reloads from Firebase', async () => {
        // A cache written by an older build, holding the exact entry that used to crash the login.
        mockCachedGlobalData = {
            projectIds: ['p1', 'p2'],
            projectsInitialData: [
                { project: { id: 'p1' }, users: [], contacts: [], workstreams: [], assistants: [] },
                { project: null, users: [], contacts: [], workstreams: [], assistants: [] },
            ],
        }
        mockGetProjectData.mockImplementation(id => Promise.resolve(project(id)))

        await loadInitialDataForLoggedUser(mockState.loggedUser)

        expect(mockGetProjectData).toHaveBeenCalledWith('p1')
        expect(mockGetProjectData).toHaveBeenCalledWith('p2')
        const { projects } = getProjectsInitialDataDispatch()
        expect(projects.map(p => p.id)).toEqual(['p1', 'p2'])
    })

    it('does not reorder loggedUser.projectIds while checking the cache', async () => {
        mockState.loggedUser.projectIds = ['p2', 'p1']
        mockCachedGlobalData = {
            projectIds: ['p1', 'p2'],
            projectsInitialData: [
                { projectId: 'p1', project: { id: 'p1' }, users: [], contacts: [], workstreams: [], assistants: [] },
                { projectId: 'p2', project: { id: 'p2' }, users: [], contacts: [], workstreams: [], assistants: [] },
            ],
        }

        await loadInitialDataForLoggedUser(mockState.loggedUser)

        expect(mockState.loggedUser.projectIds).toEqual(['p2', 'p1'])
        expect(mockGetProjectData).not.toHaveBeenCalled()
    })

    it('treats a cache-served "missing" as a failed read, not a deleted project', async () => {
        // p2's "missing" comes from the local cache (backend unreachable) — the project may well
        // exist on the server, so the entry must be dropped as a failed read (retryable/recovered
        // by the live watchers) and the payload must not be cached.
        mockGetProjectData.mockImplementation(id =>
            Promise.resolve(id === 'p1' ? project('p1') : { project: null, missingFromCache: true })
        )

        await expect(loadInitialDataForLoggedUser(mockState.loggedUser)).resolves.toBeUndefined()

        const { projects, projectsMap } = getProjectsInitialDataDispatch()
        expect(projects.map(p => p.id)).toEqual(['p1'])
        expect(projectsMap.p2).toBeUndefined()
        expect(mockSetCachedGlobalData).not.toHaveBeenCalled()
    })

    it('still logs the user in when none of the project documents exist any more', async () => {
        mockGetProjectData.mockImplementation(() => Promise.resolve(null))

        await expect(loadInitialDataForLoggedUser(mockState.loggedUser)).resolves.toBeUndefined()

        const { projects } = getProjectsInitialDataDispatch()
        expect(projects).toEqual([])
    })
})
