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

// Keep this persistence regression at the backend boundary; importing the
// unrelated modal/task graph both consumes gigabytes and initializes Firebase.
jest.mock('./noteUpdates', () => ({}))
jest.mock('../../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({}))
jest.mock('../Tasks/tasksFirestore', () => ({}))
jest.mock('../../../components/TaskListView/Utils/TasksHelper', () => ({}))
jest.mock('../../../components/Feeds/CommentsTextInput/textInputHelper', () => ({}))
jest.mock('../../../components/NotesView/NotesDV/EditorView/notesHelper', () => ({}))
jest.mock('../../../components/UIComponents/FloatModals/RevisionHistoryModal/RevisionHistoryModal', () => ({}))
jest.mock('../Goals/goalsFirestore', () => ({}))
jest.mock('../../../components/NotesView/NoteFilters/noteOwnerFilterHelper', () => ({}))
jest.mock('../Users/usersFirestore', () => ({}))
jest.mock('../Contacts/contactsFirestore', () => ({}))
jest.mock('../Skills/skillsFirestore', () => ({}))
jest.mock('../Assistants/assistantsFirestore', () => ({}))
jest.mock('../Chats/chatsFirestore', () => ({}))
jest.mock('../../NavigationService', () => ({}))

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

it('keeps metadata durable but defers unverified cached bytes instead of overwriting Storage', async () => {
    mockPut.mockClear()
    mockUpdate.mockClear()
    const uploaded = await setNoteData('p', 'n', new Uint8Array([1]), 'offline preview', { current: false }, true, {
        deferContentUpload: true,
        pendingRevision: 'latest-edit',
    })
    expect(uploaded).toBe(false)
    expect(mockPut).not.toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ preview: 'offline preview' }))
})
it('serializes older and newer snapshots to the same canonical Storage object', async () => {
    mockPut.mockClear()
    let release
    mockPut
        .mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    release = resolve
                })
        )
        .mockResolvedValueOnce()
    const first = setNoteData('p', 'n', new Uint8Array([1]), null, null, true, { contentOnly: true })
    const second = setNoteData('p', 'n', new Uint8Array([2]), null, null, true, { contentOnly: true })
    await Promise.resolve()
    await Promise.resolve()
    expect(mockPut).toHaveBeenCalledTimes(1)
    release()
    await first
    await second
    expect(mockPut.mock.calls.map(([bytes]) => Array.from(bytes))).toEqual([[1], [2]])
})
it('retains the pending upload on network failure and allows a subsequent retry', async () => {
    const { registerPendingNoteUpload, clearPendingNoteUpload } = require('../../Notes/pendingNoteUploads')
    jest.clearAllMocks()
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {})
    mockPut.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce()
    await expect(setNoteData('p', 'n', new Uint8Array([1]), null, null, true, { contentOnly: true })).resolves.toBe(
        false
    )
    expect(registerPendingNoteUpload).toHaveBeenCalled()
    expect(clearPendingNoteUpload).not.toHaveBeenCalled()
    await expect(setNoteData('p', 'n', new Uint8Array([2]), null, null, true, { contentOnly: true })).resolves.toBe(
        true
    )
    expect(clearPendingNoteUpload).toHaveBeenCalledTimes(1)
    warning.mockRestore()
})
