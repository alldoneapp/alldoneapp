import { getDb } from '../firestore'
import { watchFollowedPeople } from './followedPeopleFirestore'
import { markServerContact, startConnectionLatencySample } from '../../connectionHealth'

jest.mock('../firestore', () => ({ getDb: jest.fn() }))
jest.mock('../../connectionHealth', () => ({
    markServerContact: jest.fn(),
    startConnectionLatencySample: jest.fn(),
}))

describe('watchFollowedPeople', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('reads users and contacts from one Firestore listener', () => {
        const unsubscribe = jest.fn()
        const onSnapshot = jest.fn((options, callback) => {
            callback({
                metadata: { fromCache: false },
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
        result()
        expect(unsubscribe).toHaveBeenCalledTimes(1)
    })

    it('handles a missing following document', () => {
        const callback = jest.fn()
        getDb.mockReturnValue({
            doc: () => ({
                onSnapshot: (options, listener) => {
                    listener({ metadata: { fromCache: false }, data: () => undefined })
                    return jest.fn()
                },
            }),
        })

        watchFollowedPeople('project-1', 'logged-user', callback)

        expect(callback).toHaveBeenCalledWith('project-1', { userIds: [], contactIds: [] })
    })

    it('tracks the primary listener until server metadata arrives', () => {
        const finishSample = jest.fn()
        const onInitialSnapshot = jest.fn()
        let listener
        startConnectionLatencySample.mockReturnValue(finishSample)
        getDb.mockReturnValue({
            doc: () => ({
                onSnapshot: (options, next) => {
                    listener = next
                    return jest.fn()
                },
            }),
        })

        watchFollowedPeople('project-1', 'logged-user', jest.fn(), {
            trackConnectionHealth: true,
            onInitialSnapshot,
        })
        listener({ metadata: { fromCache: true }, data: () => ({}) })

        expect(startConnectionLatencySample).toHaveBeenCalledWith('followed_contacts_snapshot')
        expect(finishSample).not.toHaveBeenCalled()
        expect(onInitialSnapshot).toHaveBeenCalledTimes(1)

        listener({ metadata: { fromCache: false }, data: () => ({}) })

        expect(finishSample).toHaveBeenCalledTimes(1)
        expect(markServerContact).toHaveBeenCalledWith('snapshot')
        expect(onInitialSnapshot).toHaveBeenCalledTimes(1)
    })
})
