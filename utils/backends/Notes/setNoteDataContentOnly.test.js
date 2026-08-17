const mockPut = jest.fn(() => Promise.resolve())
const mockUpdate = jest.fn(() => Promise.resolve())
const mockUpdateNotesEditedDailyList = jest.fn()
const mockStartEditNoteFeedsChain = jest.fn()

jest.mock('../firestore', () => ({
    __esModule: true,
    getDb: () => ({ doc: () => ({ update: mockUpdate }) }),
    notesStorage: { ref: () => ({ child: () => ({ put: mockPut }) }) },
    updateNotesEditedDailyList: (...args) => mockUpdateNotesEditedDailyList(...args),
    startEditNoteFeedsChain: (...args) => mockStartEditNoteFeedsChain(...args),
    getId: () => 'generated-id',
    getNoteData: jest.fn(),
    logEvent: jest.fn(),
    createGenericTaskWhenMentionInTitleEdition: jest.fn(),
    createNoteFeedsChain: jest.fn(),
    createNoteUpdatedFeedsChain: jest.fn(),
    deleteLinkedGuidesNotesIfProjectIsTemplate: jest.fn(),
    deleteNoteFeedsChain: jest.fn(),
    getMentionedUsersIdsWhenEditText: jest.fn(),
    removeNoteFromInnerTasks: jest.fn(),
    setNoteOwnerFeedsChain: jest.fn(),
    setNoteProjectFeedsChain: jest.fn(),
    trackStickyNote: jest.fn(),
    untrackStickyNote: jest.fn(),
    updateNoteHighlightFeedsChain: jest.fn(),
    updateNotePrivacyFeedsChain: jest.fn(),
    updateNoteStickyDataFeedsChain: jest.fn(),
    updateNoteTitleFeedsChain: jest.fn(),
}))

jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: { getState: () => ({ loggedUser: { uid: 'me' } }), dispatch: jest.fn() },
}))

jest.mock('../../serverClock', () => ({ __esModule: true, getServerNow: () => 1700000000000 }))
jest.mock('../../connectionState', () => ({ __esModule: true, isBrowserOffline: () => false }))
jest.mock('../../Notes/pendingNoteUploads', () => ({
    __esModule: true,
    registerPendingNoteUpload: jest.fn(),
    clearPendingNoteUpload: jest.fn(),
}))

const { setNoteData } = require('./notesFirestore')

/**
 * AT-2340 — content this client only RECEIVED is persisted, but never recorded
 * as an edit by this user.
 */
describe('setNoteData', () => {
    beforeEach(() => jest.clearAllMocks())

    it('runs the full save fan-out for a local edit', async () => {
        const firstEditionRef = { current: true }

        await setNoteData('p1', 'n1', new Uint8Array([1, 2, 3]), 'a preview', firstEditionRef, true)

        expect(mockPut).toHaveBeenCalledTimes(1)
        expect(mockUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ preview: 'a preview', lastEditorId: 'me', lastEditionDate: 1700000000000 })
        )
        expect(mockUpdateNotesEditedDailyList).toHaveBeenCalledWith('p1', 'n1')
        expect(mockStartEditNoteFeedsChain).toHaveBeenCalledWith('p1', 'n1')
        expect(firstEditionRef.current).toBe(false)
    })

    it('uploads content ONLY for a collaborator-originated change', async () => {
        await setNoteData('p1', 'n1', new Uint8Array([1, 2, 3]), null, null, true, { contentOnly: true })

        // The merged document is still made durable...
        expect(mockPut).toHaveBeenCalledTimes(1)
        // ...but nothing claims this user edited it.
        expect(mockUpdate).not.toHaveBeenCalled()
        expect(mockUpdateNotesEditedDailyList).not.toHaveBeenCalled()
        expect(mockStartEditNoteFeedsChain).not.toHaveBeenCalled()
    })

    it('does not consume the first-edition latch on a content-only save', async () => {
        const firstEditionRef = { current: true }

        await setNoteData('p1', 'n1', new Uint8Array([1]), null, firstEditionRef, true, { contentOnly: true })

        // The user's own first edit must still open the started-editing feed
        // afterwards; a collaborator's change must not swallow it.
        expect(firstEditionRef.current).toBe(true)
        expect(mockStartEditNoteFeedsChain).not.toHaveBeenCalled()
    })

    it('still skips the edition-data write for a user without write access', async () => {
        await setNoteData('p1', 'n1', new Uint8Array([1]), 'preview', { current: false }, false)

        expect(mockUpdate).not.toHaveBeenCalled()
    })
})
