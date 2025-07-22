import store from '../../../redux/store'
import ContactsHelper from '../../ContactsView/Utils/ContactsHelper'

/**
 * Determine if target text match a term list
 *
 * @param contact
 * @param termList
 * @param projectIndex
 * @returns {boolean}
 */
export const matchSearchContact = (contact, termList, projectIndex) => {
    for (let term of termList) {
        if (term !== '' && !ContactsHelper.matchContactSearch(contact, term, projectIndex)) {
            return false
        }
    }

    return true
}

/**
 * Determine if a contact match with the term list
 *
 * @param contact
 * @param projectIndex
 * @returns {boolean}
 */
export const contactMatchHashtagFilters = (contact, projectIndex) => {
    const termList = Array.from(store.getState().hashtagFilters.keys())

    return termList.length === 0 || matchSearchContact(contact, termList, projectIndex)
}

export const filterContacts = (contacts, projectIndex) => {
    return contacts.filter(contact => contactMatchHashtagFilters(contact, projectIndex))
}
