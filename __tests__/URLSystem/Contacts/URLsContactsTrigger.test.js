import URLsContactsTrigger from '../../../URLSystem/Contacts/URLsContactsTrigger'
import ContactsHelper from '../../../components/ContactsView/Utils/ContactsHelper'

jest.mock('../../../components/ContactsView/Utils/ContactsHelper')
ContactsHelper.processURLContactDetails = jest.fn()
ContactsHelper.processURLContactDetailsTab = jest.fn()


describe('URLsContactsTrigger', () => {
    it('match function should match correctly', () => {
        const result = URLsContactsTrigger.match('/projects/p1/contacts/c1')
        expect(result.key).toEqual('CONTACT_DETAILS')
    })

    it('match function should not match correctly', () => {
        const result = URLsContactsTrigger.match('/wrong/url')
        expect(result).toEqual('NOT_MATCH')
    })

    it('trigger function should call processURLContactDetails when the URL is the contact detail view', () => {
        URLsContactsTrigger.trigger(null, '/projects/p1/contacts/c1')
        expect(ContactsHelper.processURLContactDetails).toHaveBeenCalledTimes(1)
    })

    it('trigger function should call processURLContactDetailsTab when the URL is the property tab', () => {
        URLsContactsTrigger.trigger(null, '/projects/p1/contacts/c1/properties')
        expect(ContactsHelper.processURLContactDetailsTab).toHaveBeenCalledTimes(1)
    })
})
