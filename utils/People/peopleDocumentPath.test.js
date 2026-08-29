import { getPeopleDocumentDescriptor } from './peopleDocumentPath'

describe('getPeopleDocumentDescriptor', () => {
    it('selects the user document for an authoritative project member', () => {
        expect(getPeopleDocumentDescriptor('project-1', 'user-1', ['user-1', 'user-2'])).toEqual({
            isMember: true,
            path: 'users/user-1',
        })
    })

    it('selects the project contact document without probing the users collection', () => {
        expect(getPeopleDocumentDescriptor('project-1', 'contact-1', ['user-1'])).toEqual({
            isMember: false,
            path: 'projectsContacts/project-1/contacts/contact-1',
        })
    })

    it('fails closed to the project-scoped contact namespace when membership data is unavailable', () => {
        expect(getPeopleDocumentDescriptor('project-1', 'person-1')).toEqual({
            isMember: false,
            path: 'projectsContacts/project-1/contacts/person-1',
        })
    })
})
