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
