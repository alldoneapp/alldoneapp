import ContactsHelper, { getNewDefaultUser } from '../../../components/ContactsView/Utils/ContactsHelper'
import URLsPeople, { URL_ALL_PROJECTS_PEOPLE } from '../../../URLSystem/People/URLsPeople'

// expo-localization loads a native module that is unavailable in the JSDOM test env (see CLAUDE.md).
// Mock it so the pure getNewDefaultUser logic can be exercised.
jest.mock('expo-localization', () => ({ locale: 'en-US', getLocales: () => [{ languageCode: 'en' }] }))

jest.mock('firebase', () => ({ firestore: {} }))
jest.mock('../../../utils/BackendBridge', () => {
    return {
        getUserDataByUidOrEmail: async () => {
            return {}
        },
        onUserWorkflowChange: () => {},
        onUserChange: () => {},
    }
})

describe('ContactsHelper class', () => {
    it('should execute processURLAllProjectsPeople correctly', () => {
        const navigation = { navigate: () => {} }
        URLsPeople.replace = jest.fn()
        ContactsHelper.processURLAllProjectsPeople(navigation)
        expect(URLsPeople.replace).toBeCalledWith(URL_ALL_PROJECTS_PEOPLE)
    })

    it('should execute processURLProjectPeople correctly', () => {
        const navigation = { navigate: () => {} }
        URLsPeople.replace = jest.fn()
        ContactsHelper.processURLProjectPeople(navigation, 0)
        expect(URLsPeople.replace).toBeCalledWith(URL_ALL_PROJECTS_PEOPLE)
    })

    it('should execute processURLPeopleDetails correctly', () => {
        const navigation = { navigate: () => {} }
        URLsPeople.replace = jest.fn()
        ContactsHelper.processURLPeopleDetails(navigation, 0, 0, 0)
        expect(URLsPeople.replace).toBeCalledTimes(0)
    })
})

describe('getNewDefaultUser identity-field hardening', () => {
    it('falls back to empty strings when identity fields are undefined', () => {
        const user = getNewDefaultUser({ uid: 'abc', displayName: undefined, email: undefined, photoURL: undefined })
        expect(user.displayName).toBe('')
        expect(user.email).toBe('')
        expect(user.photoURL).toBe('')
    })

    it('falls back to empty strings when identity fields are null', () => {
        const user = getNewDefaultUser({ uid: 'abc', displayName: null, email: null, photoURL: null })
        expect(user.displayName).toBe('')
        expect(user.email).toBe('')
        expect(user.photoURL).toBe('')
    })

    it('never leaves identity fields undefined so Firestore (ignoreUndefinedProperties) cannot drop them', () => {
        const user = getNewDefaultUser({ uid: 'abc' })
        expect(user.displayName).not.toBeUndefined()
        expect(user.email).not.toBeUndefined()
        expect(user.photoURL).not.toBeUndefined()
    })

    it('preserves valid identity values supplied by the caller', () => {
        const user = getNewDefaultUser({
            uid: 'abc',
            displayName: 'Karsten Wysk',
            email: 'karsten@alldone.app',
            photoURL: 'https://example.com/a.png',
        })
        expect(user.displayName).toBe('Karsten Wysk')
        expect(user.email).toBe('karsten@alldone.app')
        expect(user.photoURL).toBe('https://example.com/a.png')
    })
})
