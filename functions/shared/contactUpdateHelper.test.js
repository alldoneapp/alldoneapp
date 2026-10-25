jest.mock('../BatchWrapper/batchWrapper', () => ({
    BatchWrapper: jest.fn().mockImplementation(() => ({
        update: jest.fn(),
        commit: jest.fn().mockResolvedValue(undefined),
    })),
}))

jest.mock('../Feeds/contactsFeeds', () => ({
    createContactEmailChangedFeed: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../Followers/followerHelper', () => ({
    tryAddFollower: jest.fn().mockResolvedValue(undefined),
}))

const mockLoadFeedsGlobalState = jest.fn()
jest.mock('firebase-admin', () => ({ __esModule: false, name: 'admin-double' }))
jest.mock('../GlobalState/globalState', () => ({
    loadFeedsGlobalState: (...args) => mockLoadFeedsGlobalState(...args),
}))

jest.mock('../Email/emailChannelHelpers', () => ({
    normalizeEmailAddress: value =>
        String(value || '')
            .trim()
            .toLowerCase(),
}))

const { createContactEmailChangedFeed } = require('../Feeds/contactsFeeds')
const { tryAddFollower } = require('../Followers/followerHelper')
const { updateContactFields } = require('./contactUpdateHelper')

describe('contactUpdateHelper', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('updates email and emits side effects', async () => {
        const db = {
            doc(path) {
                return { path }
            },
        }

        const result = await updateContactFields({
            db,
            projectId: 'project-1',
            contact: {
                uid: 'contact-1',
                displayName: 'Jane Doe',
                email: '',
                emails: [],
            },
            userId: 'user-1',
            feedUser: { uid: 'user-1', displayName: 'User 1' },
            updates: { email: 'Jane@Example.com' },
        })

        expect(result.updated).toBe(true)
        expect(result.contact.email).toBe('jane@example.com')
        expect(result.contact.emails).toEqual(['jane@example.com'])
        expect(result.changes).toEqual(['email to "jane@example.com"'])
        expect(createContactEmailChangedFeed).toHaveBeenCalled()
        expect(tryAddFollower).toHaveBeenCalled()
    })

    test("loads the feed helpers' global state from the project before adding the follower", async () => {
        // Production failure: update_contact on a cold instance died in tryAddFollower because
        // nothing had loaded `appAdmin` into the feeds global state.
        const order = []
        mockLoadFeedsGlobalState.mockImplementation(() => order.push('state'))
        tryAddFollower.mockImplementation(async () => order.push('follower'))
        const db = {
            doc(path) {
                if (path === 'projects/project-1') {
                    return {
                        path,
                        get: async () => ({ exists: true, data: () => ({ name: 'Sales', userIds: ['user-1'] }) }),
                    }
                }
                return { path }
            },
        }

        await updateContactFields({
            db,
            projectId: 'project-1',
            contact: { uid: 'contact-1', displayName: 'Jane Doe', company: '' },
            userId: 'user-1',
            feedUser: { uid: 'user-1', displayName: 'User 1' },
            updates: { company: 'Example' },
        })

        expect(mockLoadFeedsGlobalState).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'admin-double' }),
            expect.objectContaining({ name: 'admin-double' }),
            { uid: 'user-1', displayName: 'User 1' },
            { name: 'Sales', userIds: ['user-1'], id: 'project-1' },
            [],
            null
        )
        expect(order).toEqual(['state', 'follower'])
    })

    test('returns no-op when update does not change the contact', async () => {
        const db = {
            doc(path) {
                return { path }
            },
        }

        const result = await updateContactFields({
            db,
            projectId: 'project-1',
            contact: {
                uid: 'contact-1',
                displayName: 'Jane Doe',
                email: 'jane@example.com',
                emails: ['jane@example.com'],
            },
            userId: 'user-1',
            feedUser: { uid: 'user-1', displayName: 'User 1' },
            updates: { email: 'jane@example.com' },
        })

        expect(result.updated).toBe(false)
        expect(result.changes).toEqual([])
        expect(createContactEmailChangedFeed).toHaveBeenCalledTimes(0)
        expect(tryAddFollower).toHaveBeenCalledTimes(0)
    })

    test('keeps older addresses in emails when setting a new primary email', async () => {
        const db = {
            doc(path) {
                return { path }
            },
        }

        const result = await updateContactFields({
            db,
            projectId: 'project-1',
            contact: {
                uid: 'contact-1',
                displayName: 'Jane Doe',
                email: 'jane@old.com',
                emails: ['jane@old.com'],
            },
            userId: 'user-1',
            feedUser: { uid: 'user-1', displayName: 'User 1' },
            updates: { email: 'jane@new.com' },
        })

        expect(result.updated).toBe(true)
        expect(result.contact.email).toBe('jane@new.com')
        expect(result.contact.emails).toEqual(['jane@old.com', 'jane@new.com'])
    })
})
