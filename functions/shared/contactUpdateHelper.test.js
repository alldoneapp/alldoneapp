const mockBatches = []
jest.mock('../BatchWrapper/batchWrapper', () => ({
    BatchWrapper: jest.fn().mockImplementation(() => {
        const batch = {
            update: jest.fn(),
            commit: jest.fn().mockResolvedValue(undefined),
        }
        mockBatches.push(batch)
        return batch
    }),
}))

jest.mock('../Feeds/contactsFeeds', () => ({
    createContactEmailChangedFeed: jest.fn().mockResolvedValue(undefined),
    createContactNameChangedFeed: jest.fn().mockResolvedValue(undefined),
    createContactPictureChangedFeed: jest.fn().mockResolvedValue(undefined),
    createContactCompanyChangedFeed: jest.fn().mockResolvedValue(undefined),
    createContactRoleChangedFeed: jest.fn().mockResolvedValue(undefined),
    createContactDescriptionChangedFeed: jest.fn().mockResolvedValue(undefined),
    createContactPhoneNumberChangedFeed: jest.fn().mockResolvedValue(undefined),
    createContactLinkedInChangedFeed: jest.fn().mockResolvedValue(undefined),
    createContactStatusChangedFeed: jest.fn().mockResolvedValue(undefined),
}))

const mockGetFeedObjectLastState = jest.fn()
jest.mock('../Feeds/globalFeedsHelper', () => ({
    getFeedObjectLastState: (...args) => mockGetFeedObjectLastState(...args),
}))

const mockAddContactFeedsChain = jest.fn()
jest.mock('../Feeds/contactsFeedsChains', () => ({
    addContactFeedsChain: (...args) => mockAddContactFeedsChain(...args),
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    FEED_PUBLIC_FOR_ALL: 0,
    getTaskNameWithoutMeta: value => String(value || ''),
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

const contactsFeeds = require('../Feeds/contactsFeeds')
const { createContactEmailChangedFeed } = contactsFeeds
const { tryAddFollower } = require('../Followers/followerHelper')
const { updateContactFields, writeContactCreatedFeeds } = require('./contactUpdateHelper')

const MCP_ACTOR = { uid: 'user-1', displayName: 'User 1', via: 'mcp', viaClient: 'Claude' }

function projectDb(projectData = { name: 'Sales', userIds: ['user-1'] }) {
    return {
        doc(path) {
            if (path === 'projects/project-1') {
                return { path, get: async () => ({ exists: true, data: () => projectData }) }
            }
            return { path }
        },
    }
}

describe('contactUpdateHelper', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockBatches.length = 0
        mockGetFeedObjectLastState.mockResolvedValue({ type: 'contact', isPublicFor: [0] })
        mockAddContactFeedsChain.mockResolvedValue(undefined)
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
        expect(createContactEmailChangedFeed).toHaveBeenCalledWith(
            'project-1',
            'contact-1',
            'jane@example.com',
            '',
            expect.any(Object),
            { uid: 'user-1', displayName: 'User 1' },
            true
        )
        expect(tryAddFollower).toHaveBeenCalled()
    })

    test("loads the feed helpers' global state from the project before adding the follower", async () => {
        // Production failure: update_contact on a cold instance died in tryAddFollower because
        // nothing had loaded `appAdmin` into the feeds global state.
        const order = []
        mockLoadFeedsGlobalState.mockImplementation(() => order.push('state'))
        tryAddFollower.mockImplementation(async () => order.push('follower'))

        await updateContactFields({
            db: projectDb(),
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

    // MCP feed parity: contacts and moves
    describe('an Updates entry for every field update_contact changes', () => {
        const contact = {
            uid: 'contact-1',
            displayName: 'Jane Doe',
            company: 'Old Co',
            role: 'Engineer',
            phone: '+49 1',
            description: 'Old notes',
            extendedDescription: 'Old notes',
            linkedInUrl: '',
            photoURL: 'https://old/photo.png',
            photoURL50: 'https://old/photo50.png',
            contactStatusId: 'lead',
            isPublicFor: [0],
        }
        const longDescription = 'Met at the fair. ' + 'Interested in the enterprise plan. '.repeat(10)

        test('each changed field gets its own entry, written with the actor and after the contact', async () => {
            const result = await updateContactFields({
                db: projectDb({
                    userIds: ['user-1'],
                    contactStatuses: { lead: { name: 'Lead' }, customer: { name: 'Customer' } },
                }),
                projectId: 'project-1',
                contact,
                userId: 'user-1',
                feedUser: MCP_ACTOR,
                updates: {
                    displayName: 'Jane Smith',
                    company: 'New Co',
                    role: 'CTO',
                    phone: '+49 2',
                    description: longDescription,
                    extendedDescription: longDescription,
                    linkedInUrl: 'https://www.linkedin.com/in/jane',
                    photoURL: 'https://new/photo.png',
                    photoURL50: 'https://new/photo.png',
                    photoURL300: 'https://new/photo.png',
                    contactStatusId: 'customer',
                },
            })

            expect(result.updated).toBe(true)
            const [contactBatch, feedBatch] = mockBatches
            expect(contactBatch.update).toHaveBeenCalledTimes(1)
            expect(contactBatch.commit).toHaveBeenCalledTimes(1)
            expect(feedBatch.commit).toHaveBeenCalledTimes(1)

            const call = name => contactsFeeds[name].mock.calls[0]
            expect(call('createContactNameChangedFeed')).toEqual([
                'project-1',
                'contact-1',
                'Jane Smith',
                'Jane Doe',
                feedBatch,
                MCP_ACTOR,
                true,
            ])
            expect(call('createContactPictureChangedFeed').slice(2, 4)).toEqual([
                'https://new/photo.png',
                'https://old/photo50.png',
            ])
            expect(call('createContactCompanyChangedFeed').slice(2, 4)).toEqual(['New Co', 'Old Co'])
            expect(call('createContactRoleChangedFeed').slice(2, 4)).toEqual(['CTO', 'Engineer'])
            expect(call('createContactPhoneNumberChangedFeed').slice(2, 4)).toEqual(['+49 2', '+49 1'])
            expect(call('createContactLinkedInChangedFeed').slice(2, 4)).toEqual([
                'https://www.linkedin.com/in/jane',
                '',
            ])
            expect(call('createContactStatusChangedFeed').slice(2, 4)).toEqual(['Customer', 'Lead'])
            // One entry for the two description fields, shortened like the app's description entries.
            expect(contactsFeeds.createContactDescriptionChangedFeed).toHaveBeenCalledTimes(1)
            const [newDescription, oldDescription] = call('createContactDescriptionChangedFeed').slice(2, 4)
            expect(newDescription).toBe('Met at the fair. Interested in the enterprise plan...')
            expect(oldDescription).toBe('Old notes')
            expect(createContactEmailChangedFeed).not.toHaveBeenCalled()
            for (const helper of Object.values(contactsFeeds)) {
                for (const args of helper.mock.calls) {
                    expect(args[5]).toBe(MCP_ACTOR)
                    expect(args[6]).toBe(true)
                }
            }
        })

        test('a status removed, or one the project no longer has, is named as such', async () => {
            await updateContactFields({
                db: projectDb({ userIds: ['user-1'], contactStatuses: {} }),
                projectId: 'project-1',
                contact,
                userId: 'user-1',
                feedUser: MCP_ACTOR,
                updates: { contactStatusId: null },
            })

            expect(contactsFeeds.createContactStatusChangedFeed.mock.calls[0].slice(2, 4)).toEqual(['', 'Unknown'])
        })

        test('a contact without a feed object gets one, as private as the contact', async () => {
            mockGetFeedObjectLastState.mockResolvedValue(undefined)

            await updateContactFields({
                db: projectDb(),
                projectId: 'project-1',
                contact: { ...contact, isPrivate: true, recorderUserId: 'user-1', isPublicFor: ['user-1'] },
                userId: 'user-1',
                feedUser: MCP_ACTOR,
                updates: { company: 'New Co' },
            })

            const feedBatch = mockBatches[1]
            expect(feedBatch.feedObjects['contact-1']).toMatchObject({
                type: 'contact',
                name: 'Jane Doe',
                avatarUrl: 'https://old/photo50.png',
                isPublicFor: ['user-1'],
            })
            expect(contactsFeeds.createContactCompanyChangedFeed).toHaveBeenCalled()
        })

        test('a failing feed never fails the contact write or the call', async () => {
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
            contactsFeeds.createContactCompanyChangedFeed.mockRejectedValueOnce(new Error('feed store down'))

            const result = await updateContactFields({
                db: projectDb(),
                projectId: 'project-1',
                contact,
                userId: 'user-1',
                feedUser: MCP_ACTOR,
                updates: { company: 'New Co' },
            })

            expect(result).toMatchObject({ success: true, updated: true })
            expect(mockBatches[0].commit).toHaveBeenCalledTimes(1)
            expect(warn).toHaveBeenCalledWith(
                '[contactUpdateHelper] Could not write the contact change feeds',
                expect.objectContaining({ error: 'feed store down' })
            )
            warn.mockRestore()
        })
    })

    describe('writeContactCreatedFeeds', () => {
        test("writes the app's contact-added chain with the actor", async () => {
            const created = { uid: 'contact-9', displayName: 'New Person', isPublicFor: [0, 'user-1'] }

            const written = await writeContactCreatedFeeds({
                db: projectDb(),
                projectId: 'project-1',
                contact: created,
                feedUser: MCP_ACTOR,
                userId: 'user-1',
            })

            expect(written).toBe(true)
            expect(mockLoadFeedsGlobalState.mock.calls[0][2]).toBe(MCP_ACTOR)
            expect(mockAddContactFeedsChain).toHaveBeenCalledWith('project-1', created, '', 'contact-9', false, true)
        })

        test('a failing chain is logged, not thrown', async () => {
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
            mockAddContactFeedsChain.mockRejectedValueOnce(new Error('boom'))

            await expect(
                writeContactCreatedFeeds({
                    db: projectDb(),
                    projectId: 'project-1',
                    contact: { uid: 'contact-9', isPublicFor: [0] },
                    feedUser: MCP_ACTOR,
                    userId: 'user-1',
                })
            ).resolves.toBe(false)
            expect(warn).toHaveBeenCalled()
            warn.mockRestore()
        })
    })
})
