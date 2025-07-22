import ContactsHelper from '../../../components/ContactsView/Utils/ContactsHelper'
import URLsPeople, { URL_ALL_PROJECTS_PEOPLE } from '../../../URLSystem/People/URLsPeople'

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
