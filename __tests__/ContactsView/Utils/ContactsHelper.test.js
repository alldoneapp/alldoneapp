import ContactsHelper, { getNewDefaultUser } from '../../../components/ContactsView/Utils/ContactsHelper'
import URLsPeople, {
    URL_ALL_PROJECTS_PEOPLE_FOLLOWED,
    URL_PROJECT_PEOPLE_FOLLOWED,
} from '../../../URLSystem/People/URLsPeople'

// Pin the device language so the suite is independent of the host machine's navigator.language.
// Mock it so the pure getNewDefaultUser logic can be exercised.
jest.mock('../../../utils/WebShims/Localization', () => ({
    locale: 'en-US',
    getLocales: () => [{ languageCode: 'en' }],
}))

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
        expect(URLsPeople.replace).toHaveBeenCalledWith(URL_ALL_PROJECTS_PEOPLE_FOLLOWED)
    })

    it('should execute processURLProjectPeople correctly', () => {
        const navigation = { navigate: () => {} }
        URLsPeople.replace = jest.fn()
        ContactsHelper.processURLProjectPeople(navigation, 0)

        // A concrete project takes the per-project branch, which passes route
        // data alongside the constant; the URL is what this test is about.
        expect(URLsPeople.replace.mock.calls[0][0]).toBe(URL_PROJECT_PEOPLE_FOLLOWED)
    })

    it('should execute processURLPeopleDetails correctly', () => {
        const navigation = { navigate: () => {} }
        URLsPeople.replace = jest.fn()
        ContactsHelper.processURLPeopleDetails(navigation, 0, 0, 0)
        expect(URLsPeople.replace).toHaveBeenCalledTimes(0)
    })
})

describe('getNewDefaultUser identity-field hardening', () => {
    it('uses a bundled profile picture when the provider has no identity fields', () => {
        const user = getNewDefaultUser({ uid: 'abc', displayName: undefined, email: undefined, photoURL: undefined })
        expect(user.displayName).toBe('')
        expect(user.email).toBe('')
        expect(user.photoURL).toMatch(/\/images\/generic-user\.svg$/)
        expect(user.photoURL50).toBe(user.photoURL)
        expect(user.photoURL300).toBe(user.photoURL)
    })

    it('uses a bundled profile picture when provider fields are null', () => {
        const user = getNewDefaultUser({ uid: 'abc', displayName: null, email: null, photoURL: null })
        expect(user.displayName).toBe('')
        expect(user.email).toBe('')
        expect(user.photoURL).toMatch(/\/images\/generic-user\.svg$/)
    })

    it('never leaves identity fields undefined so Firestore (ignoreUndefinedProperties) cannot drop them', () => {
        const user = getNewDefaultUser({ uid: 'abc' })
        expect(user.displayName).not.toBeUndefined()
        expect(user.email).not.toBeUndefined()
        expect(user.photoURL).not.toBeUndefined()
    })

    it('initializes project-scoped integration state as a map', () => {
        const user = getNewDefaultUser({ uid: 'abc' })
        expect(user.apisConnected).toEqual({})
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
        expect(user.photoURL50).toBe(user.photoURL)
        expect(user.photoURL300).toBe(user.photoURL)
    })

    it('fills empty pictures without replacing supplied thumbnails', () => {
        const user = getNewDefaultUser({ uid: 'abc', photoURL: '', photoURL50: 'https://example.com/small.png' })
        expect(user.photoURL).toBe('https://example.com/small.png')
        expect(user.photoURL50).toBe('https://example.com/small.png')
    })
})
