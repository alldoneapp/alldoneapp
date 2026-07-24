/**
 * @jest-environment jsdom
 */

import URLsContacts from '../../../URLSystem/Contacts/URLsContacts'
import store from '../../../redux/store'


describe('URLsContacts', () => {
    it('replace function should work correctly', () => {
        URLsContacts.replace('CONTACT_DETAILS', null, 'p1', 'c1')
        const { lastVisitedScreen } = store.getState()
        expect(lastVisitedScreen).toEqual(['/projects/p1/contacts/c1'])
    })

    it('push function should work correctly', () => {
        let { lastVisitedScreen } = store.getState()
        expect(lastVisitedScreen.length).toEqual(1)
        URLsContacts.push('CONTACT_DETAILS', null, 'p2', 'c2')
        expect(lastVisitedScreen.length).toEqual(2)
    })

    it('getPath function should work correctly', () => {
        const result = URLsContacts.getPath('CONTACT_DETAILS', 'p1', 'c1')
        expect(result).toEqual('projects/p1/contacts/c1')
    })

    it('setTitle function should work correctly', () => {
        URLsContacts.setTitle('CONTACT_DETAILS', 'p1', 'c1')
        expect(document.title).toEqual('Alldone.app - Project - Contact - Contact details')
    })
})
