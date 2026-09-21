import store from '../../redux/store'
import { initAnonymousSesion, setAnonymousSesionData } from '../../redux/actions'
import URLTrigger from '../../URLSystem/URLTrigger'
import { getDateFormatFromCurrentLocation } from '../Geolocation/GeolocationHelper'
import { getGlobalAssistants } from '../backends/Assistants/assistantsFirestore'
import { getAdministratorUser, getProjectData } from '../backends/firestore'
import {
    watchAdministratorUser,
    watchGlobalAssistants,
    watchLoggedUserData,
    watchProjectData,
} from './initialLoadHelper'
import { loadInitialDataForAnonymous } from './anonymousUserHelper'

jest.mock('../../redux/store', () => ({
    dispatch: jest.fn(),
}))

jest.mock('../../redux/actions', () => ({
    initAnonymousSesion: jest.fn((loggedUser, currentUser) => ({
        type: 'Init anonymous session',
        loggedUser,
        currentUser,
    })),
    setAnonymousSesionData: jest.fn((project, users, workstreams, contacts, assistants) => ({
        type: 'Set anonymous session data',
        project,
        users,
        workstreams,
        contacts,
        assistants,
    })),
}))

jest.mock('../Geolocation/GeolocationHelper', () => ({
    getDateFormatFromCurrentLocation: jest.fn(),
}))

jest.mock('../backends/Assistants/assistantsFirestore', () => ({
    getGlobalAssistants: jest.fn(),
}))

jest.mock('../backends/firestore', () => ({
    getAdministratorUser: jest.fn(),
    getProjectData: jest.fn(),
}))

jest.mock('./initialLoadHelper', () => ({
    watchAdministratorUser: jest.fn(),
    watchGlobalAssistants: jest.fn(),
    watchLoggedUserData: jest.fn(),
    watchProjectData: jest.fn(),
}))

jest.mock('../NavigationService', () => ({
    __esModule: true,
    default: {},
}))

jest.mock('../../URLSystem/URLTrigger', () => ({
    __esModule: true,
    default: { processUrl: jest.fn() },
}))

jest.mock('../SharedHelper', () => ({
    __esModule: true,
    default: {},
    ANONYMOUS_USER_DATA: {
        displayName: 'Anonymous User',
        email: 'anonymous@alldone.com',
        isAnonymous: true,
        gold: 0,
        premium: { status: 'free' },
        monthlyTraffic: 0,
        monthlyXp: 0,
    },
}))

const PUBLIC_NOTE_URL = '/projects/i4lHsMvjDoyqa1VjGxDO/notes/3C5Ty9yvBDok2AH01r2u/editor'
const PROJECT_ID = 'i4lHsMvjDoyqa1VjGxDO'

describe('loadInitialDataForAnonymous', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        getDateFormatFromCurrentLocation.mockResolvedValue({
            dateFormat: 'DD/MM/YYYY',
            mondayFirstInCalendar: true,
        })
        getProjectData.mockResolvedValue({ id: PROJECT_ID, name: 'Public project' })
        getGlobalAssistants.mockResolvedValue([{ uid: 'global-assistant' }])
        getAdministratorUser.mockResolvedValue({ uid: 'administrator', roleOnly: true })
    })

    it('boots from public project data without watching a private user document', async () => {
        const projectUser = {
            uid: 'note-creator',
            displayName: 'Shared user',
        }

        await loadInitialDataForAnonymous(PROJECT_ID, PUBLIC_NOTE_URL, {
            projectUser,
            currentUser: projectUser,
        })

        const [loggedUser, currentUser] = initAnonymousSesion.mock.calls[0]
        expect(loggedUser).toEqual(
            expect.objectContaining({
                uid: 'note-creator',
                displayName: 'Anonymous User',
                isAnonymous: true,
                premium: { status: 'free' },
                projectIds: [PROJECT_ID],
                guideProjectIds: [],
                templateProjectIds: [],
                archivedProjectIds: [],
                dateFormat: 'DD/MM/YYYY',
            })
        )
        expect(currentUser).toBe(loggedUser)
        expect(getProjectData).toHaveBeenCalledWith(PROJECT_ID)
        expect(setAnonymousSesionData).toHaveBeenCalledWith(
            { id: PROJECT_ID, name: 'Public project' },
            [projectUser],
            [],
            [],
            [],
            [{ uid: 'global-assistant' }],
            { uid: 'administrator', roleOnly: true }
        )
        expect(watchLoggedUserData).not.toHaveBeenCalled()
        expect(watchGlobalAssistants).toHaveBeenCalledTimes(1)
        expect(watchAdministratorUser).not.toHaveBeenCalled()
        expect(watchProjectData).toHaveBeenCalledWith(PROJECT_ID, false, false)
        expect(URLTrigger.processUrl).toHaveBeenCalledWith(expect.any(Object), PUBLIC_NOTE_URL)
        expect(store.dispatch).toHaveBeenCalledTimes(2)
    })
})
