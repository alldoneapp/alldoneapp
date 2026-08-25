/**
 * AT-2428. `processURLPeopleDetails` is reached with an id that may be a user OR a contact —
 * opening a person's note from search routes both through `/user/{id}/...` — so it asks
 * `users/{id}` first and falls back to the contact lookup.
 *
 * Production therefore logged, for an ordinary contact, a failed REST read plus
 * `User document not found in Firestore: /users/... (confirmed by a direct server read)` as a
 * console ERROR, which is exactly what made a working navigation look like a broken account.
 *
 * The probe makes that first question cheap. What these tests pin is the other half: the cheap
 * answer is only allowed to stand when something else explains it. With no contact behind the id
 * either, the lookup must escalate to the VERIFIED read — that is what still recovers a real user
 * whose realtime read was wrong, and what keeps a genuinely dangling id reported rather than
 * silently swallowed.
 */
const mockGetUserDataByUidOrEmail = jest.fn()
const mockGetContactData = jest.fn()

jest.mock('../../../utils/WebShims/Localization', () => ({
    locale: 'en-US',
    getLocales: () => [{ languageCode: 'en' }],
}))

jest.mock('../../../utils/BackendBridge', () => ({
    __esModule: true,
    default: {
        getUserDataByUidOrEmail: (...args) => mockGetUserDataByUidOrEmail(...args),
        onUserWorkflowChange: () => {},
        onUserChange: () => {},
    },
}))

jest.mock('../../../utils/backends/Contacts/contactsFirestore', () => ({
    getContactData: (...args) => mockGetContactData(...args),
}))

const ContactsHelper = require('../../../components/ContactsView/Utils/ContactsHelper').default
const store = require('../../../redux/store').default

describe('processURLPeopleDetails user probe (AT-2428)', () => {
    const navigation = { navigate: jest.fn() }
    const project = { id: 'project-1', index: 1, userIds: ['logged-user'] }

    beforeEach(() => {
        mockGetUserDataByUidOrEmail.mockReset()
        mockGetContactData.mockReset()
        navigation.navigate.mockReset()
        jest.spyOn(store, 'dispatch').mockImplementation(() => {})
        jest.spyOn(store, 'getState').mockReturnValue({
            loggedUser: { uid: 'logged-user', projectIds: ['project-1'] },
            selectedSidebarTab: null,
            loggedUserProjects: [project],
            // index > ALL_PROJECTS_INDEX puts the route on the "inside a concrete project" branch,
            // which is the one that opens a person's detailed view.
            loggedUserProjectsMap: { 'project-1': project },
            selectedNavItem: 'USER_PROFILE',
            // Read by the URL builders when they title the route.
            projectUsers: { 'project-1': [] },
            projectContacts: { 'project-1': [] },
            projectAssistants: { 'project-1': [] },
            globalAssistants: [],
        })
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    it('asks the user question cheaply, as a probe', async () => {
        mockGetUserDataByUidOrEmail.mockResolvedValue({ uid: 'real-user' })

        await ContactsHelper.processURLPeopleDetails(navigation, 'project-1', 'real-user', undefined, 'USER_PROFILE')

        expect(mockGetUserDataByUidOrEmail).toHaveBeenCalledTimes(1)
        expect(mockGetUserDataByUidOrEmail).toHaveBeenCalledWith('real-user', { absenceIsExpected: true })
    })

    it('never escalates when the id turns out to be a contact', async () => {
        mockGetUserDataByUidOrEmail.mockResolvedValue(null)
        mockGetContactData.mockResolvedValue({ id: 'contact-1', displayName: 'A contact' })

        await ContactsHelper.processURLPeopleDetails(
            navigation,
            'project-1',
            'contact-1',
            'PEOPLE_DETAILS',
            'USER_PROFILE'
        )

        // The contact explains the absence, so the verification round trip and the ERROR log that
        // used to accompany every contact navigation never happen.
        expect(mockGetContactData).toHaveBeenCalledWith('project-1', 'contact-1')
        expect(mockGetUserDataByUidOrEmail).toHaveBeenCalledTimes(1)
    })

    it('escalates to the verified read when the id is neither a user nor a contact', async () => {
        mockGetUserDataByUidOrEmail.mockResolvedValue(null)
        mockGetContactData.mockResolvedValue(null)

        await ContactsHelper.processURLPeopleDetails(
            navigation,
            'project-1',
            'ZB7uJwP96zwloGUiCkY5',
            'PEOPLE_DETAILS',
            'USER_PROFILE'
        )

        expect(mockGetUserDataByUidOrEmail).toHaveBeenCalledTimes(2)
        // The escalation passes NO options: it is the loud, server-verified read.
        expect(mockGetUserDataByUidOrEmail).toHaveBeenLastCalledWith('ZB7uJwP96zwloGUiCkY5')
    })

    it('uses a user the verified read recovers after the probe missed it', async () => {
        const recovered = { uid: 'flaky-user', displayName: 'Recovered' }
        mockGetUserDataByUidOrEmail.mockResolvedValueOnce(null).mockResolvedValueOnce(recovered)
        mockGetContactData.mockResolvedValue(null)

        await ContactsHelper.processURLPeopleDetails(
            navigation,
            'project-1',
            'flaky-user',
            'PEOPLE_DETAILS',
            'USER_PROFILE'
        )

        // Recovering the document must actually open the person, not just quieten a log line.
        const openedUserDv = navigation.navigate.mock.calls.some(
            ([route, data]) => route === 'UserDetailedView' && data && data.contact === recovered
        )
        expect(openedUserDv).toBe(true)
    })
})
