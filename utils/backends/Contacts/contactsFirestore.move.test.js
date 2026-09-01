const mockTargetSet = jest.fn(async () => {})
const mockSourceUpdate = jest.fn(async () => {})
const mockSourceDelete = jest.fn(async () => {})
const mockAddContactFeedsChain = jest.fn()

const mockDb = {
    doc: jest.fn(path => {
        if (path === 'projectsContacts/project-b/contacts/contact-1') return { set: mockTargetSet }
        if (path === 'projectsContacts/project-a/contacts/contact-1') {
            return { update: mockSourceUpdate, delete: mockSourceDelete }
        }
        throw new Error(`Unexpected Firestore path: ${path}`)
    }),
}

jest.mock('firebase/compat/app', () => ({
    __esModule: true,
    default: {},
}))
jest.mock('../firestore', () => ({
    addContactFeedsChain: (...args) => mockAddContactFeedsChain(...args),
    getDb: () => mockDb,
}))
jest.mock('./contactUpdates', () => ({}))
jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: {
        getState: () => ({ loggedUser: { uid: 'user-1' }, route: '' }),
    },
}))
jest.mock('../../../functions/BatchWrapper/batchWrapper', () => ({ BatchWrapper: jest.fn() }))
jest.mock('../../../components/Followers/FollowerConstants', () => ({}))
jest.mock('../../../components/TaskListView/Utils/TasksHelper', () => ({
    __esModule: true,
    default: {},
}))
jest.mock('../../../redux/actions', () => ({}))
jest.mock('../../../utils/NavigationService', () => ({
    __esModule: true,
    default: {},
}))
jest.mock('../../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: {},
}))
jest.mock('../../../utils/TabNavigationConstants', () => ({}))
jest.mock('../Notes/notesFirestore', () => ({}))
jest.mock('../Chats/chatsFirestore', () => ({}))
jest.mock('../../../components/Feeds/Utils/FeedsConstants', () => ({ FEED_PUBLIC_FOR_ALL: 0 }))

const { setContactProject } = require('./contactsFirestore')

describe('setContactProject', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('preserves the linked note and marks the source as a move before deleting it', async () => {
        await setContactProject(
            { id: 'project-a' },
            { id: 'project-b' },
            {
                uid: 'contact-1',
                displayName: 'Erik Bartel',
                noteId: 'note-1',
                isPublicFor: [0, 'user-1'],
            }
        )

        // Merged, never overwritten: an id the destination project already holds
        // (a retried move, a calendar object keyed by its event id) would
        // otherwise strip the destination's server access projection and be
        // refused by the rules.
        expect(mockTargetSet).toHaveBeenCalledWith(
            expect.objectContaining({ noteId: 'note-1', movingToOtherProjectId: null }),
            { merge: true }
        )
        expect(mockSourceUpdate).toHaveBeenCalledWith({ movingToOtherProjectId: 'project-b' })
        expect(mockSourceUpdate.mock.invocationCallOrder[0]).toBeLessThan(mockSourceDelete.mock.invocationCallOrder[0])
    })
})
