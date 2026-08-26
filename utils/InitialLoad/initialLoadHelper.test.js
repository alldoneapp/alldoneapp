import store from '../../redux/store'
import { setAdministratorAndGlobalAssistants, setAdministratorUser, setGlobalAssistants } from '../../redux/actions'
import { getGlobalAssistants, watchAssistants } from '../backends/Assistants/assistantsFirestore'
import { getAdministratorUser, unwatch, watchUserData } from '../backends/firestore'
import { loadGlobalData, watchAdministratorUser, watchGlobalAssistants } from './initialLoadHelper'

let mockBrowserIsOffline = false

jest.mock('../../redux/store', () => ({
    dispatch: jest.fn(),
    getState: jest.fn(),
}))

jest.mock('../backends/Assistants/assistantsFirestore', () => ({
    getGlobalAssistants: jest.fn(),
    getProjectAssistants: jest.fn(),
    watchAssistants: jest.fn(),
}))

jest.mock('../backends/Contacts/contactsFirestore', () => ({
    getProjectContacts: jest.fn(),
}))

jest.mock('../backends/Users/usersFirestore', () => ({
    getProjectUsers: jest.fn(),
    removeCopyProjectIdFromUser: jest.fn(),
}))

jest.mock('../backends/Workstreams/workstreamsFirestore', () => ({
    getProjectWorkstreams: jest.fn(),
}))

jest.mock('../backends/firestore', () => ({
    getAdministratorUser: jest.fn(),
    getProjectData: jest.fn(),
    unwatch: jest.fn(),
    watchProject: jest.fn(),
    watchProjectInvitations: jest.fn(),
    watchUserData: jest.fn(),
}))

jest.mock('../../redux/actions', () => ({
    clearOptimisticFocusTask: jest.fn(),
    navigateToAllProjectsTasks: jest.fn(),
    removeProjectData: jest.fn(),
    setAdministratorAndGlobalAssistants: jest.fn(),
    setAdministratorUser: jest.fn(administratorUser => ({ type: 'Set administrator user', administratorUser })),
    setChatNotificationsInProject: jest.fn(),
    setGlobalAssistants: jest.fn(assistants => ({ type: 'Set global assistants', assistants })),
    setInvitationsInProject: jest.fn(),
    setShowEndCopyProjectPopup: jest.fn(),
    storeLoggedUser: jest.fn(),
    updateUserProject: jest.fn(),
}))

jest.mock('../../components/AdminPanel/Assistants/assistantsHelper', () => ({
    GLOBAL_PROJECT_ID: 'global-project',
}))

jest.mock('../SharedHelper', () => ({
    __esModule: true,
    default: { redirectToPrivateResource: jest.fn() },
    ANONYMOUS_USER_DATA: {},
}))

jest.mock('../HelperFunctions', () => ({ forceCloseModals: jest.fn() }))
jest.mock('../TabNavigationConstants', () => ({ ROOT_ROUTES: [] }))
jest.mock('../NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../backends/Chats/chatsComments', () => ({ watchChatNotifications: jest.fn() }))
jest.mock('./staleProjectSelfHeal', () => ({ pruneStaleProjectIds: jest.fn() }))
jest.mock('./projectRecovery', () => ({ recoverDroppedProject: jest.fn() }))
jest.mock('./projectDataLoader', () => ({ forgetProjectData: jest.fn() }))
jest.mock('../connectionState', () => ({ isBrowserOffline: () => mockBrowserIsOffline }))

describe('watchGlobalAssistants', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockBrowserIsOffline = false
    })

    it('arms the global assistant watcher and stores each snapshot', () => {
        const assistants = [{ uid: 'assistant-1' }]
        watchAssistants.mockImplementation((projectId, watcherKey, callback) => callback(assistants))

        watchGlobalAssistants()

        expect(unwatch).toHaveBeenCalledWith('globalAssistants')
        expect(watchAssistants).toHaveBeenCalledWith('global-project', 'globalAssistants', expect.any(Function))
        expect(setGlobalAssistants).toHaveBeenCalledWith(assistants)
        expect(store.dispatch).toHaveBeenCalledWith({ type: 'Set global assistants', assistants })
    })
})

describe('watchAdministratorUser', () => {
    let watcherCallback
    let consoleWarn

    beforeEach(() => {
        jest.clearAllMocks()
        store.getState.mockReturnValue({ administratorUser: { uid: 'admin-1' } })
        watchUserData.mockImplementation((userId, isLoggedUser, callback) => {
            watcherCallback = callback
        })
        getAdministratorUser.mockResolvedValue({ uid: 'admin-1' })
        consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        consoleWarn.mockRestore()
    })

    it('replaces any prior watcher and stores valid snapshots immediately', () => {
        watchAdministratorUser('admin-1')
        watcherCallback({ uid: 'admin-1', displayName: 'Administrator' })

        expect(unwatch).toHaveBeenCalledWith('administratorUser')
        expect(watchUserData).toHaveBeenCalledWith('admin-1', false, expect.any(Function), 'administratorUser')
        expect(setAdministratorUser).toHaveBeenCalledWith({ uid: 'admin-1', displayName: 'Administrator' })
    })

    it('preserves the last valid Administrator when a missing snapshot cannot be verified', async () => {
        getAdministratorUser.mockRejectedValue(new Error('offline'))
        watchAdministratorUser('admin-1')

        watcherCallback(null)
        await Promise.resolve()
        await Promise.resolve()

        expect(setAdministratorUser).not.toHaveBeenCalled()
        expect(consoleWarn).toHaveBeenCalledWith(
            expect.stringContaining('preserving the last valid state'),
            expect.any(Error)
        )
    })

    it('clears the Administrator only after an authoritative read confirms absence', async () => {
        getAdministratorUser.mockResolvedValue({})
        watchAdministratorUser('admin-1')

        watcherCallback(null)
        await Promise.resolve()
        await Promise.resolve()

        expect(setAdministratorUser).toHaveBeenCalledWith({})
    })

    it('ignores a stale missing verification after a newer valid snapshot arrives', async () => {
        let finishVerification
        getAdministratorUser.mockReturnValue(
            new Promise(resolve => {
                finishVerification = resolve
            })
        )
        watchAdministratorUser('admin-1')

        watcherCallback(null)
        watcherCallback({ uid: 'admin-1', displayName: 'Administrator' })
        finishVerification({})
        await Promise.resolve()
        await Promise.resolve()

        expect(setAdministratorUser).toHaveBeenCalledTimes(1)
        expect(setAdministratorUser).toHaveBeenCalledWith({ uid: 'admin-1', displayName: 'Administrator' })
    })

    it('moves the watcher when the authoritative role now names another user', async () => {
        getAdministratorUser.mockResolvedValue({ uid: 'admin-2' })
        watchAdministratorUser('admin-1')

        watcherCallback(null)
        await Promise.resolve()
        await Promise.resolve()

        expect(setAdministratorUser).toHaveBeenCalledWith({ uid: 'admin-2' })
        expect(watchUserData).toHaveBeenLastCalledWith('admin-2', false, expect.any(Function), 'administratorUser')
    })
})

describe('loadGlobalData', () => {
    let consoleError
    let consoleWarn

    beforeEach(() => {
        jest.clearAllMocks()
        store.getState.mockReturnValue({ globalAssistants: [], administratorUser: {} })
        getAdministratorUser.mockResolvedValue({ uid: 'admin-1' })
        getGlobalAssistants.mockResolvedValue([{ uid: 'assistant-1' }])
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
        consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        consoleError.mockRestore()
        consoleWarn.mockRestore()
    })

    it('stores authoritatively resolved global data', async () => {
        await loadGlobalData()

        expect(setAdministratorAndGlobalAssistants).toHaveBeenCalledWith({ uid: 'admin-1' }, [{ uid: 'assistant-1' }])
    })

    it('preserves existing state when authoritative reads exhaust their retries', async () => {
        getAdministratorUser.mockRejectedValue(new Error('unavailable'))

        await loadGlobalData(5)

        expect(setAdministratorAndGlobalAssistants).not.toHaveBeenCalled()
        expect(consoleWarn).toHaveBeenCalledWith(
            '[GlobalData] Global data is still unavailable; preserving the last valid state.'
        )
    })

    it('does not delay offline boot with retries for uncached optional global data', async () => {
        mockBrowserIsOffline = true
        getAdministratorUser.mockRejectedValue(new Error('offline'))

        await loadGlobalData()

        expect(getAdministratorUser).toHaveBeenCalledTimes(1)
        expect(setAdministratorAndGlobalAssistants).not.toHaveBeenCalled()
        expect(consoleWarn).toHaveBeenCalledWith(
            '[GlobalData] Global data is unavailable offline; preserving the last valid state.'
        )
    })
})
