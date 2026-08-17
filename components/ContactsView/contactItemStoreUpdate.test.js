import {
    getContactBacklinksWatcherKey,
    getContactItemStoreUpdate,
    getContactPresentationData,
} from './contactItemStoreUpdate'

describe('ContactItem store updates', () => {
    const projects = [{ id: 'project-1' }]
    const currentState = {
        loggedUserProjects: projects,
        smallScreenNavigation: false,
        isMiddleScreen: false,
    }

    it('does not re-render for an unrelated Redux action', () => {
        expect(
            getContactItemStoreUpdate(currentState, {
                loggedUserProjects: projects,
                smallScreenNavigation: false,
                isMiddleScreen: false,
                unrelatedValue: 123,
            })
        ).toBeNull()
    })

    it('returns only presentation values that changed', () => {
        expect(
            getContactItemStoreUpdate(currentState, {
                loggedUserProjects: projects,
                smallScreenNavigation: true,
                isMiddleScreen: false,
            })
        ).toEqual({ smallScreenNavigation: true })
    })

    it('uses a unique instance suffix for backlink subscriptions', () => {
        expect(getContactBacklinksWatcherKey('project-1', 'contact-1', 'instance-1')).not.toBe(
            getContactBacklinksWatcherKey('project-1', 'contact-1', 'instance-2')
        )
    })

    it('applies project privacy without mutating the Redux contact object', () => {
        const contact = { uid: 'user-1', displayName: 'User' }

        expect(getContactPresentationData(contact, { isPrivate: true, isPublicFor: ['user-1'] })).toEqual({
            ...contact,
            isPrivate: true,
            isPublicFor: ['user-1'],
        })
        expect(contact).toEqual({ uid: 'user-1', displayName: 'User' })
    })
})
