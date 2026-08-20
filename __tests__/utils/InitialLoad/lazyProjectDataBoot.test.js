/**
 * AT-2386 — login must stop loading every project's people.
 *
 * Before this, `loadProjectsDataFromFirebase` awaited four collection reads PER PROJECT inside the
 * login bundle: users, contacts, workstreams and assistants. On the reporting account that was 14
 * projects x 4 = 56 collection reads, 523 contact documents among them, all on the critical path
 * and all serialized into the 24h localStorage startup cache.
 *
 * What this suite pins:
 *   1. login reads project DOCUMENTS only,
 *   2. every project is still seeded with EMPTY ARRAYS - a dozen consumers read
 *      `state.projectUsers[projectId].length` and friends without a guard, so the key must exist
 *      from the first frame even though the content is deferred,
 *   3. the priority projects are awaited BEFORE URL routing, because `processURLProjectsUserTasks`
 *      resolves a `/projects/<id>/user/<uid>/tasks` deep link out of `projectUsers[projectId]`,
 *   4. the rest are warmed afterwards, and
 *   5. nothing outside `loggedUser.projectIds` is ever loaded - which is what makes "only active
 *      projects" a guarantee rather than a side effect of `updateInactiveProjectsData`.
 */

const mockDispatch = jest.fn()
const mockState = {
    loggedUser: {
        uid: 'user-1',
        projectIds: ['p1', 'p2', 'p3'],
        defaultProjectId: 'p2',
        dateFormat: 'DD/MM/YYYY',
        language: 'en',
    },
    initialUrl: '/',
}

jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: {
        getState: () => mockState,
        dispatch: (...args) => mockDispatch(...args),
    },
}))

jest.mock('../../../utils/UserDataCache', () => ({
    __esModule: true,
    default: {
        getCachedUserData: () => null,
        setCachedUserData: jest.fn(),
        getCachedGlobalData: () => null,
        setCachedGlobalData: jest.fn(),
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
    getProjectDataResult: (...args) => mockGetProjectData(...args),
}))

// These four are the reads that used to be part of the login bundle. They are mocked so the suite
// can assert they are NOT called - a real call would also be visible as an unmocked import error.
const mockGetProjectUsers = jest.fn(() => Promise.resolve([]))
const mockGetProjectContacts = jest.fn(() => Promise.resolve([]))
const mockGetProjectWorkstreams = jest.fn(() => Promise.resolve([]))
const mockGetProjectAssistants = jest.fn(() => Promise.resolve([]))

jest.mock('../../../utils/backends/Users/usersFirestore', () => ({
    fetchUserDataResult: jest.fn(),
    getUserData: jest.fn(),
    updateUserDataDirectly: jest.fn(),
    getProjectUsers: (...args) => mockGetProjectUsers(...args),
}))
jest.mock('../../../utils/backends/Contacts/contactsFirestore', () => ({
    getProjectContacts: (...args) => mockGetProjectContacts(...args),
}))
jest.mock('../../../utils/backends/Workstreams/workstreamsFirestore', () => ({
    getProjectWorkstreams: (...args) => mockGetProjectWorkstreams(...args),
}))
jest.mock('../../../utils/backends/Assistants/assistantsFirestore', () => ({
    getProjectAssistants: (...args) => mockGetProjectAssistants(...args),
}))

const mockSetProjectsInitialData = jest.fn((...args) => ({ type: 'SET_PROJECTS_INITIAL_DATA', args }))
jest.mock('../../../redux/actions', () => ({
    initLogInForLoggedUser: jest.fn(payload => ({ type: 'INIT_LOGIN', payload })),
    setProjectsInitialData: (...args) => mockSetProjectsInitialData(...args),
    updateLoadingStep: jest.fn((step, message) => ({ type: 'UPDATE_LOADING_STEP', step, message })),
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

// The ordering assertions need a recorder, so the loader is mocked here rather than exercised;
// its own behaviour is covered by `utils/InitialLoad/projectDataLoader.test.js`.
const callLog = []
const mockEnsureProjectsDataLoaded = jest.fn(projectIds => {
    callLog.push(['ensure', [...projectIds]])
    return Promise.resolve(true)
})
const mockWarmProjectsData = jest.fn(projectIds => {
    callLog.push(['warm', [...projectIds]])
    return () => {}
})
jest.mock('../../../utils/InitialLoad/projectDataLoader', () => ({
    ensureProjectsDataLoaded: (...args) => mockEnsureProjectsDataLoaded(...args),
    warmProjectsData: (...args) => mockWarmProjectsData(...args),
    forgetAllProjectData: jest.fn(),
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

const mockProcessUrl = jest.fn(() => callLog.push(['processUrl', []]))
jest.mock('../../../URLSystem/URLTrigger', () => ({
    __esModule: true,
    default: { processUrl: (...args) => mockProcessUrl(...args) },
}))
jest.mock('../../../utils/NavigationService', () => ({ __esModule: true, default: {} }))
jest.mock('../../../utils/backends/Premium/stripePremiumFirestore', () => ({
    checkUserPremiumStatusStripe: jest.fn(() => Promise.resolve()),
}))
jest.mock('../../../utils/analytics/analytics', () => ({ trackEvent: jest.fn() }))

const { loadInitialDataForLoggedUser } = require('../../../utils/InitialLoad/loggedUserHelper')

const project = id => ({ id, name: `Project ${id}` })

const login = () => loadInitialDataForLoggedUser({ ...mockState.loggedUser })

describe("AT-2386 login no longer loads every project's people", () => {
    beforeEach(() => {
        jest.clearAllMocks()
        callLog.length = 0
        mockGetProjectData.mockImplementation(projectId =>
            Promise.resolve({ project: project(projectId), missingFromCache: false })
        )
    })

    it('reads project documents only', async () => {
        await login()

        expect(mockGetProjectData).toHaveBeenCalledTimes(3)
        expect(mockGetProjectUsers).not.toHaveBeenCalled()
        expect(mockGetProjectContacts).not.toHaveBeenCalled()
        expect(mockGetProjectWorkstreams).not.toHaveBeenCalled()
        expect(mockGetProjectAssistants).not.toHaveBeenCalled()
    })

    it('still seeds every project with empty arrays, so unguarded consumers cannot crash', async () => {
        await login()

        // setProjectsInitialData(projects, projectsMap, users, workstreams, contacts, assistants)
        const [, , projectUsers, projectWorkstreams, projectContacts, projectAssistants] =
            mockSetProjectsInitialData.mock.calls[0]

        ;['p1', 'p2', 'p3'].forEach(projectId => {
            expect(projectUsers[projectId]).toEqual([])
            expect(projectWorkstreams[projectId]).toEqual([])
            expect(projectContacts[projectId]).toEqual([])
            expect(projectAssistants[projectId]).toEqual([])
        })
    })

    it('awaits the priority projects before URL routing, then warms the rest', async () => {
        await login()

        expect(callLog.map(entry => entry[0])).toEqual(['ensure', 'warm', 'processUrl'])

        const [, ensured] = callLog[0]
        const [, warmed] = callLog[1]

        // Booting into "All projects" leaves no selected project, so the default project leads.
        expect(ensured[0]).toBe('p2')
        // Every project is covered exactly once across the two buckets.
        expect([...ensured, ...warmed].sort()).toEqual(['p1', 'p2', 'p3'])
        expect(ensured.filter(id => warmed.includes(id))).toEqual([])
    })

    it("never loads a project outside the logged user's project ids", async () => {
        // `updateInactiveProjectsData` has already stripped guides, templates and archived ids out
        // of `loggedUser.projectIds` by this point, so this is what makes "only active projects" a
        // guarantee of the loader rather than an accident of that reducer.
        await login()

        const requested = callLog.filter(([kind]) => kind === 'ensure' || kind === 'warm').flatMap(([, ids]) => ids)

        requested.forEach(projectId => expect(mockState.loggedUser.projectIds).toContain(projectId))
    })

    it('does not request data for a project whose document could not be read', async () => {
        mockGetProjectData.mockImplementation(projectId =>
            Promise.resolve(
                projectId === 'p3'
                    ? { project: null, missingFromCache: false }
                    : { project: project(projectId), missingFromCache: false }
            )
        )

        await login()

        const requested = callLog.filter(([kind]) => kind === 'ensure' || kind === 'warm').flatMap(([, ids]) => ids)

        expect(requested).not.toContain('p3')
        expect(requested.sort()).toEqual(['p1', 'p2'])
    })
})
