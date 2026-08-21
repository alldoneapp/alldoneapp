import store from '../../redux/store'
import { setGlobalAssistants } from '../../redux/actions'
import { watchAssistants } from '../backends/Assistants/assistantsFirestore'
import { watchGlobalAssistants } from './initialLoadHelper'

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
    setAdministratorUser: jest.fn(),
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

describe('watchGlobalAssistants', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('arms the global assistant watcher and stores each snapshot', () => {
        const assistants = [{ uid: 'assistant-1' }]
        watchAssistants.mockImplementation((projectId, watcherKey, callback) => callback(assistants))

        watchGlobalAssistants()

        expect(watchAssistants).toHaveBeenCalledWith('global-project', 'globalAssistants', expect.any(Function))
        expect(setGlobalAssistants).toHaveBeenCalledWith(assistants)
        expect(store.dispatch).toHaveBeenCalledWith({ type: 'Set global assistants', assistants })
    })
})
