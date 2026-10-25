/**
 * @jest-environment jsdom
 *
 * AT-2508 - the rules of the pending-contact set.
 *
 * Every case here fails against the pre-AT-2508 code for the simple reason that none of this
 * existed: a created contact reached the list only through a snapshot, and the snapshot cannot
 * name it until the server has written its `readerIds` projection.
 */

const mockDispatch = jest.fn()
let mockStoreState

jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: {
        getState: () => mockStoreState,
        dispatch: (...args) => mockDispatch(...args),
    },
}))

jest.mock('../../../redux/actions', () => ({
    setContactsInProject: (projectId, contacts) => ({ type: 'Set contacts in project', projectId, contacts }),
}))

let mockOffline = false
jest.mock('../../connectionState', () => ({
    isBrowserOffline: () => mockOffline,
}))

const {
    PENDING_CONTACT_FLAG,
    PENDING_CONTACT_TIMEOUT_MS,
    getPendingContacts,
    hasPendingContacts,
    mergePendingContacts,
    publishOptimisticContactCreated,
    publishOptimisticContactCreateFailed,
    resetOptimisticContactCreates,
} = require('./optimisticContactCreate')

const PROJECT = 'project-1'

const contact = (uid, extra = {}) => ({ uid, displayName: `Contact ${uid}`, recorderUserId: 'me', ...extra })

/** What the last `setContactsInProject` mockDispatch carried for a project. */
const lastPublished = (projectId = PROJECT) => {
    for (let index = mockDispatch.mock.calls.length - 1; index >= 0; index--) {
        const action = mockDispatch.mock.calls[index][0]
        if (action && action.type === 'Set contacts in project' && action.projectId === projectId) {
            return action.contacts
        }
    }
    return null
}

/** Emulates the redux round trip: what is dispatched becomes what the store holds. */
const applyDispatchesToStore = () => {
    mockDispatch.mockImplementation(action => {
        if (action && action.type === 'Set contacts in project') {
            mockStoreState.projectContacts[action.projectId] = action.contacts
        }
    })
}

beforeEach(() => {
    jest.useFakeTimers()
    mockDispatch.mockReset()
    mockOffline = false
    mockStoreState = { projectContacts: {} }
    applyDispatchesToStore()
    resetOptimisticContactCreates()
})

afterEach(() => {
    resetOptimisticContactCreates()
    jest.useRealTimers()
})

describe('publishing a pending contact', () => {
    it('puts the contact into the project slice immediately, flagged as pending', () => {
        mockStoreState.projectContacts[PROJECT] = [contact('existing')]

        publishOptimisticContactCreated(PROJECT, 'new-1', contact('new-1'))

        const published = lastPublished()
        expect(published.map(item => item.uid)).toEqual(['existing', 'new-1'])
        expect(published.find(item => item.uid === 'new-1')[PENDING_CONTACT_FLAG]).toBe(true)
        // The settled contact is untouched - the pending one is purely additive.
        expect(published.find(item => item.uid === 'existing')[PENDING_CONTACT_FLAG]).toBeUndefined()
    })

    it('forces the published id onto the contact, so the row can never key off a stale one', () => {
        publishOptimisticContactCreated(PROJECT, 'minted-id', contact('whatever-the-caller-had'))

        expect(getPendingContacts(PROJECT).map(item => item.uid)).toEqual(['minted-id'])
    })

    it('ignores an incomplete publication rather than putting a blank row on screen', () => {
        publishOptimisticContactCreated(null, 'new-1', contact('new-1'))
        publishOptimisticContactCreated(PROJECT, null, contact('new-1'))
        publishOptimisticContactCreated(PROJECT, 'new-1', null)

        expect(hasPendingContacts(PROJECT)).toBe(false)
        expect(mockDispatch).not.toHaveBeenCalled()
    })

    it('keeps several contacts in flight at once', () => {
        publishOptimisticContactCreated(PROJECT, 'new-1', contact('new-1'))
        publishOptimisticContactCreated(PROJECT, 'new-2', contact('new-2'))

        expect(lastPublished().map(item => item.uid)).toEqual(['new-1', 'new-2'])
    })

    it('keeps projects apart', () => {
        publishOptimisticContactCreated(PROJECT, 'new-1', contact('new-1'))
        publishOptimisticContactCreated('project-2', 'new-2', contact('new-2'))

        expect(lastPublished(PROJECT).map(item => item.uid)).toEqual(['new-1'])
        expect(lastPublished('project-2').map(item => item.uid)).toEqual(['new-2'])
    })
})

describe('retiring a pending contact', () => {
    it('drops it in the same delivery that brings the real one, so the row never blinks', () => {
        publishOptimisticContactCreated(PROJECT, 'new-1', contact('new-1'))

        const merged = mergePendingContacts(PROJECT, [contact('existing'), contact('new-1', { readerIds: [0] })])

        // One row for the contact, and it is the settled one - not two, and never zero.
        expect(merged.filter(item => item.uid === 'new-1')).toHaveLength(1)
        expect(merged.find(item => item.uid === 'new-1')[PENDING_CONTACT_FLAG]).toBeUndefined()
        expect(hasPendingContacts(PROJECT)).toBe(false)
    })

    it('KEEPS it while the snapshot still cannot see it - the whole point of the window', () => {
        publishOptimisticContactCreated(PROJECT, 'new-1', contact('new-1'))

        // This is the ordinary case for ~7s after the write: the projection has not landed, so
        // the query matches everything EXCEPT the contact just created.
        const merged = mergePendingContacts(PROJECT, [contact('existing')])

        expect(merged.map(item => item.uid)).toEqual(['existing', 'new-1'])
        expect(hasPendingContacts(PROJECT)).toBe(true)
    })

    it('survives any number of snapshots that do not name it', () => {
        publishOptimisticContactCreated(PROJECT, 'new-1', contact('new-1'))

        for (let index = 0; index < 5; index++) {
            mergePendingContacts(PROJECT, [contact('existing')])
        }

        expect(hasPendingContacts(PROJECT)).toBe(true)
    })

    it('removes it when the write is rejected', () => {
        mockStoreState.projectContacts[PROJECT] = [contact('existing')]
        publishOptimisticContactCreated(PROJECT, 'new-1', contact('new-1'))

        publishOptimisticContactCreateFailed(PROJECT, 'new-1')

        expect(lastPublished().map(item => item.uid)).toEqual(['existing'])
        expect(hasPendingContacts(PROJECT)).toBe(false)
    })

    it('is silent when a rollback names an id that is no longer pending', () => {
        publishOptimisticContactCreated(PROJECT, 'new-1', contact('new-1'))
        mergePendingContacts(PROJECT, [contact('new-1')])
        mockDispatch.mockClear()

        publishOptimisticContactCreateFailed(PROJECT, 'new-1')

        // The settled row must not be disturbed by a late rollback.
        expect(mockDispatch).not.toHaveBeenCalled()
    })

    it('removes it when nothing else ever does', () => {
        mockStoreState.projectContacts[PROJECT] = [contact('existing')]
        publishOptimisticContactCreated(PROJECT, 'new-1', contact('new-1'))

        jest.advanceTimersByTime(PENDING_CONTACT_TIMEOUT_MS)

        expect(hasPendingContacts(PROJECT)).toBe(false)
        expect(lastPublished().map(item => item.uid)).toEqual(['existing'])
    })

    it('does not fire the backstop before its time', () => {
        publishOptimisticContactCreated(PROJECT, 'new-1', contact('new-1'))

        jest.advanceTimersByTime(PENDING_CONTACT_TIMEOUT_MS - 1)

        expect(hasPendingContacts(PROJECT)).toBe(true)
    })

    it('holds the row mockOffline instead of claiming the contact was not created', () => {
        mockOffline = true
        publishOptimisticContactCreated(PROJECT, 'new-1', contact('new-1'))

        jest.advanceTimersByTime(PENDING_CONTACT_TIMEOUT_MS * 3)
        expect(hasPendingContacts(PROJECT)).toBe(true)

        // ...and retires normally once the browser is back and the window comes round again.
        mockOffline = false
        jest.advanceTimersByTime(PENDING_CONTACT_TIMEOUT_MS)
        expect(hasPendingContacts(PROJECT)).toBe(false)
    })

    it('restarts the window for a re-published id rather than doubling it', () => {
        publishOptimisticContactCreated(PROJECT, 'new-1', contact('new-1'))
        jest.advanceTimersByTime(PENDING_CONTACT_TIMEOUT_MS - 100)
        publishOptimisticContactCreated(PROJECT, 'new-1', contact('new-1'))

        jest.advanceTimersByTime(200)
        expect(hasPendingContacts(PROJECT)).toBe(true)

        jest.advanceTimersByTime(PENDING_CONTACT_TIMEOUT_MS)
        expect(hasPendingContacts(PROJECT)).toBe(false)
    })
})

describe('merging', () => {
    it('returns the snapshot list BY REFERENCE when nothing is pending', () => {
        const contacts = [contact('a'), contact('b')]

        // The no-pending path is every project almost all of the time; it must not allocate,
        // because a fresh array identity re-renders the whole contacts view.
        expect(mergePendingContacts(PROJECT, contacts)).toBe(contacts)
    })

    it('never lets a stale pending copy shadow the settled contact', () => {
        publishOptimisticContactCreated(PROJECT, 'new-1', { ...contact('new-1'), displayName: 'Typed name' })

        const merged = mergePendingContacts(PROJECT, [{ ...contact('new-1'), displayName: 'Stored name' }])

        expect(merged).toHaveLength(1)
        expect(merged[0].displayName).toBe('Stored name')
    })

    it('tolerates a malformed snapshot payload', () => {
        publishOptimisticContactCreated(PROJECT, 'new-1', contact('new-1'))

        expect(mergePendingContacts(PROJECT, null).map(item => item.uid)).toEqual(['new-1'])
        expect(mergePendingContacts(PROJECT, [null, undefined]).map(item => item && item.uid)).toContain('new-1')
    })
})

describe('republishing', () => {
    it('recomputes from the settled rows, so repeated publications cannot pile up', () => {
        mockStoreState.projectContacts[PROJECT] = [contact('existing')]

        publishOptimisticContactCreated(PROJECT, 'new-1', contact('new-1'))
        publishOptimisticContactCreated(PROJECT, 'new-2', contact('new-2'))
        publishOptimisticContactCreateFailed(PROJECT, 'new-1')

        // 'new-1' left exactly once and 'existing' was never duplicated by the round trips.
        expect(lastPublished().map(item => item.uid)).toEqual(['existing', 'new-2'])
    })
})
