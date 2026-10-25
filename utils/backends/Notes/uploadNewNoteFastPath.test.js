/**
 * AT-2488 — `uploadNewNote` resolves when the NOTE EXISTS, not when everything
 * around it has finished.
 *
 * The user-visible half of this task is the form that now says "Creating Note…";
 * this is the other half — shortening what it has to say that for. The old
 * function awaited the feeds chain, a mention-task batch, an analytics round trip
 * AND a verification `get()` of the document it had just written, all on the path
 * between pressing Enter and the note opening. None of them is a precondition for
 * opening the note, and the verification read in particular proved nothing:
 * online, the awaited `set()` only resolves on the server ack.
 *
 * The one thing that did NOT move is the empty content seed put — it writes the
 * same Storage path the editor's autosave does, so it has to be settled before
 * the note opens. It is merely issued earlier, concurrently with the document
 * write, which is where its cost goes.
 *
 * The subtler bug fixed along the way: a side effect that failed used to REJECT
 * the whole creation for a note that had, in fact, been written — so the caller
 * reported "creation failed" about a note the user would then find in their list.
 */

const mockSet = jest.fn(() => Promise.resolve())
const mockGet = jest.fn(() => Promise.resolve({ exists: true }))
const mockPut = jest.fn(() => Promise.resolve())
const mockCreateNoteFeedsChain = jest.fn(() => Promise.resolve())
const mockCreateGenericTaskWhenMention = jest.fn(() => Promise.resolve())
const mockTrackStickyNote = jest.fn(() => Promise.resolve())
const mockLogEvent = jest.fn(() => Promise.resolve())

let mockIsOffline = false // `mock` prefix required: jest.mock factories may not close over other outer variables

jest.mock('../firestore', () => ({
    __esModule: true,
    getDb: () => ({
        collection: () => ({ doc: () => ({ set: (...args) => mockSet(...args) }) }),
        doc: () => ({ get: (...args) => mockGet(...args) }),
    }),
    notesStorage: { ref: () => ({ child: () => ({ put: (...args) => mockPut(...args) }) }) },
    getId: () => 'generated-id',
    logEvent: (...args) => mockLogEvent(...args),
    createNoteFeedsChain: (...args) => mockCreateNoteFeedsChain(...args),
    trackStickyNote: (...args) => mockTrackStickyNote(...args),
    getMentionedUsersIdsWhenEditText: () => [],
    getNoteData: jest.fn(),
    createGenericTaskWhenMentionInTitleEdition: jest.fn(),
    createNoteUpdatedFeedsChain: jest.fn(),
    deleteLinkedGuidesNotesIfProjectIsTemplate: jest.fn(),
    deleteNoteFeedsChain: jest.fn(),
    removeNoteFromInnerTasks: jest.fn(),
    setNoteOwnerFeedsChain: jest.fn(),
    setNoteProjectFeedsChain: jest.fn(),
    startEditNoteFeedsChain: jest.fn(),
    untrackStickyNote: jest.fn(),
    updateNoteHighlightFeedsChain: jest.fn(),
    updateNotePrivacyFeedsChain: jest.fn(),
    updateNoteStickyDataFeedsChain: jest.fn(),
    updateNoteTitleFeedsChain: jest.fn(),
    updateNotesEditedDailyList: jest.fn(),
}))

jest.mock('../Tasks/tasksFirestore', () => ({
    __esModule: true,
    createGenericTaskWhenMention: (...args) => mockCreateGenericTaskWhenMention(...args),
    setTaskNote: jest.fn(),
}))

jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: { getState: () => ({ loggedUser: { uid: 'me' } }), dispatch: jest.fn() },
}))

jest.mock('../../serverClock', () => ({ __esModule: true, getServerNow: () => 1700000000000 }))
jest.mock('../../connectionState', () => ({ __esModule: true, isBrowserOffline: () => mockIsOffline }))
jest.mock('../../Notes/pendingNoteUploads', () => ({
    __esModule: true,
    registerPendingNoteUpload: jest.fn(),
    clearPendingNoteUpload: jest.fn(),
}))
jest.mock('./noteCreationFollow', () => ({ __esModule: true, stampCreatorAsFollower: note => note }))
jest.mock('../../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { getProjectById: () => ({ userIds: ['me'] }) },
}))

const { uploadNewNote } = require('./notesFirestore')

const noteData = () => ({
    title: 'My Note',
    extendedTitle: 'My Note',
    userId: 'me',
    creatorId: 'me',
    stickyData: { stickyEndDate: 0 },
})

// Lets the background side effects run so their assertions are not racy.
const settleBackground = async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
}

describe('uploadNewNote — fast path (AT-2488)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockIsOffline = false
        // `clearAllMocks` clears calls but KEEPS implementations, so a
        // `mockRejectedValue` from one case would otherwise leak into every case
        // after it — and a rejection with no spy installed prints as a real warning.
        mockSet.mockReset().mockResolvedValue(undefined)
        mockGet.mockReset().mockResolvedValue({ exists: true })
        mockPut.mockReset().mockResolvedValue(undefined)
        mockCreateNoteFeedsChain.mockReset().mockResolvedValue(undefined)
        mockCreateGenericTaskWhenMention.mockReset().mockResolvedValue(undefined)
        mockTrackStickyNote.mockReset().mockResolvedValue(undefined)
        mockLogEvent.mockReset().mockResolvedValue(undefined)
    })

    it('resolves as soon as the note document is written', async () => {
        // Hold every backgrounded side effect open: the promise must still resolve.
        // (The seed content put is NOT one of them — see the ordering test below.)
        mockCreateNoteFeedsChain.mockReturnValue(new Promise(() => {}))
        mockCreateGenericTaskWhenMention.mockReturnValue(new Promise(() => {}))
        mockTrackStickyNote.mockReturnValue(new Promise(() => {}))
        mockLogEvent.mockReturnValue(new Promise(() => {}))

        const note = await uploadNewNote('p1', noteData())

        expect(note.id).toBe('generated-id')
        expect(mockSet).toHaveBeenCalledTimes(1)
    })

    it('starts the seed content upload alongside the document write, and waits for it', async () => {
        // `setNoteData` writes the SAME Storage path, and the editor autosaves 3s
        // after it opens — which is right after this resolves. A seed put left in
        // the background could therefore land after the user's first save and blank
        // what they typed. So it must be settled before this function resolves...
        let resolvePut
        mockPut.mockReturnValue(new Promise(resolve => (resolvePut = resolve)))

        let settled = false
        const pending = uploadNewNote('p1', noteData()).then(note => {
            settled = true
            return note
        })

        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()

        // ...it is issued concurrently with the document write, not after it...
        expect(mockPut).toHaveBeenCalledTimes(1)
        expect(settled).toBe(false)

        resolvePut()
        await expect(pending).resolves.toEqual(expect.objectContaining({ id: 'generated-id' }))
    })

    it('does not let a failing seed upload fail the creation', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => {})
        mockPut.mockRejectedValue(new Error('storage down'))

        await expect(uploadNewNote('p1', noteData())).resolves.toEqual(expect.objectContaining({ id: 'generated-id' }))

        console.warn.mockRestore()
    })

    it('never re-reads the document it just wrote', async () => {
        await uploadNewNote('p1', noteData())
        await settleBackground()

        // Online, `set()` resolves on the server ack — the extra `get()` was a
        // second full round trip that could not learn anything new.
        expect(mockGet).not.toHaveBeenCalled()
    })

    it('still performs every side effect, just not on the critical path', async () => {
        await uploadNewNote('p1', { ...noteData(), stickyData: { stickyEndDate: 123 } })
        await settleBackground()

        expect(mockPut).toHaveBeenCalledTimes(1)
        expect(mockCreateNoteFeedsChain).toHaveBeenCalledTimes(1)
        expect(mockCreateGenericTaskWhenMention).toHaveBeenCalledTimes(1)
        expect(mockTrackStickyNote).toHaveBeenCalledWith('p1', 'generated-id', 123)
        expect(mockLogEvent).toHaveBeenCalledWith('new_note', { id: 'generated-id', uid: 'me' })
    })

    it('does not track a sticky end date the note does not have', async () => {
        await uploadNewNote('p1', noteData())
        await settleBackground()

        expect(mockTrackStickyNote).not.toHaveBeenCalled()
    })

    it('does NOT fail the creation when a side effect fails', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => {})
        mockCreateNoteFeedsChain.mockRejectedValue(new Error('feeds down'))
        mockLogEvent.mockImplementation(() => {
            throw new Error('analytics exploded synchronously')
        })

        // The note document was written; reporting "creation failed" here would be
        // a lie the user can disprove by looking at their list.
        await expect(uploadNewNote('p1', noteData())).resolves.toEqual(expect.objectContaining({ id: 'generated-id' }))
        await settleBackground()

        expect(console.warn).toHaveBeenCalled()
        console.warn.mockRestore()
    })

    it('still fails the creation when the note document itself cannot be written', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {})
        mockSet.mockRejectedValue(new Error('permission-denied'))

        await expect(uploadNewNote('p1', noteData())).rejects.toThrow('permission-denied')

        console.error.mockRestore()
    })

    it('retries a failed-precondition write before giving up', async () => {
        jest.useFakeTimers()
        const failedPrecondition = Object.assign(new Error('failed'), { code: 'failed-precondition' })
        mockSet.mockRejectedValueOnce(failedPrecondition).mockResolvedValueOnce(undefined)

        const pending = uploadNewNote('p1', noteData())
        await Promise.resolve()
        await Promise.resolve()
        await jest.advanceTimersByTimeAsync(1000)

        await expect(pending).resolves.toEqual(expect.objectContaining({ id: 'generated-id' }))
        expect(mockSet).toHaveBeenCalledTimes(2)

        jest.useRealTimers()
    })

    it('offline, does not await the note document write either', async () => {
        mockIsOffline = true
        // Offline no server ack can ever arrive, so awaiting one would hang note
        // creation forever (AT-2340). This is the shape the online path now matches.
        mockSet.mockReturnValue(new Promise(() => {}))

        // Storage has no offline queue at all, so awaiting either write would hang
        // creation forever.
        mockPut.mockReturnValue(new Promise(() => {}))

        const note = await uploadNewNote('p1', noteData())

        expect(note.id).toBe('generated-id')
        expect(mockSet).toHaveBeenCalledTimes(1)
    })
})
