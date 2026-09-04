/**
 * AT-2508 - `addContactToProject` must put the row on screen BEFORE the write, and take it away
 * again only when the write is actually rejected.
 *
 * A/B against the pre-AT-2508 code: every case in the first two blocks fails there, because the
 * function published nothing at all and a rejection escaped as an unhandled rejection with the
 * row (and the form) already gone.
 */

const mockSet = jest.fn(async () => {})
const mockUploadAvatarPhotos = jest.fn(async () => ['url', 'url50', 'url300', 'feedUrl'])
const mockAddContactFeedsChain = jest.fn()
const mockLogEvent = jest.fn()
const mockPublishCreated = jest.fn()
const mockPublishFailed = jest.fn()

/** Records the order of the events we care about, which is the whole contract here. */
let mockTimeline = []

const mockDb = {
    doc: jest.fn(() => ({
        set: async (...args) => {
            mockTimeline.push('set')
            return mockSet(...args)
        },
    })),
}

jest.mock('firebase/compat/app', () => ({ __esModule: true, default: {} }))
jest.mock('../firestore', () => ({
    addContactFeedsChain: (...args) => mockAddContactFeedsChain(...args),
    getDb: () => mockDb,
    getId: () => 'minted-contact-id',
    logEvent: (...args) => mockLogEvent(...args),
    mapContactData: (uid, contact) => ({ uid, ...contact }),
    uploadAvatarPhotos: async (...args) => {
        mockTimeline.push('uploadAvatarPhotos')
        return mockUploadAvatarPhotos(...args)
    },
    updateEditionData: () => {},
    globalWatcherUnsub: {},
}))
jest.mock('./optimisticContactCreate', () => ({
    mergePendingContacts: (projectId, contacts) => contacts,
    publishOptimisticContactCreated: (...args) => {
        mockTimeline.push('publishCreated')
        return mockPublishCreated(...args)
    },
    publishOptimisticContactCreateFailed: (...args) => {
        mockTimeline.push('publishFailed')
        return mockPublishFailed(...args)
    },
}))
jest.mock('./contactUpdates', () => ({}))
jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: { getState: () => ({ loggedUser: { uid: 'user-1' }, route: '' }) },
}))
jest.mock('../../../functions/BatchWrapper/batchWrapper', () => ({ BatchWrapper: jest.fn() }))
jest.mock('../../../components/Followers/FollowerConstants', () => ({}))
jest.mock('../../../components/TaskListView/Utils/TasksHelper', () => ({ __esModule: true, default: {} }))
jest.mock('../../../redux/actions', () => ({}))
jest.mock('../../../utils/NavigationService', () => ({ __esModule: true, default: {} }))
jest.mock('../../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {},
}))
jest.mock('../../../utils/TabNavigationConstants', () => ({}))
jest.mock('../Notes/notesFirestore', () => ({}))
jest.mock('../Chats/chatsFirestore', () => ({}))
jest.mock('../../../components/Feeds/Utils/FeedsConstants', () => ({ FEED_PUBLIC_FOR_ALL: 0 }))
jest.mock('../accessProjection', () => ({ CROSS_PROJECT_DESTINATION_WRITE: 'cross' }))
jest.mock('../cachedSnapshotGate', () => ({ createCachedSnapshotGate: () => ({}) }))
jest.mock('../../performance/firestoreSnapshotPerformance', () => ({ createFirstSnapshotPerformance: () => ({}) }))

const { addContactToProject } = require('./contactsFirestore')

const newContact = (extra = {}) => ({
    displayName: 'David Massanek',
    email: '',
    photoURL: '',
    recorderUserId: 'user-1',
    ...extra,
})

beforeEach(() => {
    jest.clearAllMocks()
    mockTimeline = []
    mockSet.mockImplementation(async () => {})
})

describe('putting the row on screen', () => {
    it('publishes the contact BEFORE the write goes out', async () => {
        await addContactToProject('project-1', newContact())

        // The order is the point: publishing after the `set()` would reintroduce the whole
        // reported wait, because the ack is already seconds in.
        expect(mockTimeline).toEqual(['publishCreated', 'set'])
    })

    it('publishes before the avatar upload too, so a picture cannot delay the row', async () => {
        await addContactToProject('project-1', newContact({ photoURL: 'blob:photo' }))

        expect(mockTimeline).toEqual(['publishCreated', 'uploadAvatarPhotos', 'set'])
    })

    it('publishes under the id it actually writes', async () => {
        await addContactToProject('project-1', newContact())

        const [projectId, contactId] = mockPublishCreated.mock.calls[0]
        expect(projectId).toBe('project-1')
        expect(contactId).toBe('minted-contact-id')
        expect(mockDb.doc).toHaveBeenCalledWith('projectsContacts/project-1/contacts/minted-contact-id')
    })

    it('publishes the typed name, so the row the user sees is theirs', async () => {
        await addContactToProject('project-1', newContact())

        expect(mockPublishCreated.mock.calls[0][2].displayName).toBe('David Massanek')
    })

    it('never publishes an unresolved picture into the shared contacts slice', async () => {
        const blob = { size: 1 }
        await addContactToProject('project-1', newContact({ photoURL: blob, photoURL50: blob, photoURL300: blob }))

        const published = mockPublishCreated.mock.calls[0][2]
        expect(published.photoURL).toBe('')
        expect(published.photoURL50).toBe('')
        expect(published.photoURL300).toBe('')
        // ...while the document that is actually stored keeps the uploaded URLs.
        expect(mockSet.mock.calls[0][0].photoURL).toBe('url')
    })
})

describe('taking the row away again', () => {
    it('rolls the row back when the write is rejected, and still reports the failure', async () => {
        mockSet.mockImplementation(async () => {
            throw new Error('permission-denied')
        })

        await expect(addContactToProject('project-1', newContact())).rejects.toThrow('permission-denied')

        expect(mockPublishFailed).toHaveBeenCalledWith('project-1', 'minted-contact-id')
        // Nothing may claim the contact exists.
        expect(mockAddContactFeedsChain).not.toHaveBeenCalled()
        expect(mockLogEvent).not.toHaveBeenCalled()
    })

    it('rolls back a failed avatar upload as well', async () => {
        mockUploadAvatarPhotos.mockImplementation(async () => {
            throw new Error('storage/unauthorized')
        })

        await expect(addContactToProject('project-1', newContact({ photoURL: 'blob:photo' }))).rejects.toThrow(
            'storage/unauthorized'
        )

        expect(mockPublishFailed).toHaveBeenCalledWith('project-1', 'minted-contact-id')
    })

    it('leaves the row standing on a successful write - the snapshot retires it, not the ack', async () => {
        await addContactToProject('project-1', newContact())

        // Retiring here is what produced AT-2500's row-gap-row flicker for tasks: the ack lands
        // ~7s before the access projection the list query needs.
        expect(mockPublishFailed).not.toHaveBeenCalled()
    })
})

describe('everything else is unchanged', () => {
    it('still reports the created contact, writes the feed and logs the event', async () => {
        const onComplete = jest.fn()

        await addContactToProject('project-1', newContact({ email: 'david@example.com' }), onComplete)

        expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ uid: 'minted-contact-id' }))
        expect(mockAddContactFeedsChain).toHaveBeenCalled()
        expect(mockLogEvent).toHaveBeenCalledWith('new_contact', {
            id: 'minted-contact-id',
            email: 'david@example.com',
        })
    })
})
