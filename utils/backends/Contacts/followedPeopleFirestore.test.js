import { getDb } from '../firestore'
import { watchFollowedPeople } from './followedPeopleFirestore'

jest.mock('../firestore', () => ({ getDb: jest.fn() }))

describe('watchFollowedPeople', () => {
    it('reads users and contacts from one Firestore listener', () => {
        const unsubscribe = jest.fn()
        const onSnapshot = jest.fn(callback => {
            callback({
                data: () => ({
                    users: { 'user-1': true, 'user-2': true },
                    contacts: { 'contact-1': true },
                }),
            })
            return unsubscribe
        })
        const doc = jest.fn(() => ({ onSnapshot }))
        const callback = jest.fn()
        getDb.mockReturnValue({ doc })

        const result = watchFollowedPeople('project-1', 'logged-user', callback)

        expect(doc).toHaveBeenCalledWith('usersFollowing/project-1/entries/logged-user')
        expect(onSnapshot).toHaveBeenCalledTimes(1)
        expect(callback).toHaveBeenCalledWith('project-1', {
            userIds: ['user-1', 'user-2'],
            contactIds: ['contact-1'],
        })
        expect(result).toBe(unsubscribe)
    })

    it('handles a missing following document', () => {
        const callback = jest.fn()
        getDb.mockReturnValue({
            doc: () => ({
                onSnapshot: listener => listener({ data: () => undefined }),
            }),
        })

        watchFollowedPeople('project-1', 'logged-user', callback)

        expect(callback).toHaveBeenCalledWith('project-1', { userIds: [], contactIds: [] })
    })
})
