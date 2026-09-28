import { act, renderHook } from '@testing-library/react'

const mockDispatch = jest.fn()
const mockQueueMove = jest.fn()
const mockWaitForMove = jest.fn()
const mockFinishLoading = jest.fn()

jest.mock('react-redux', () => ({
    useSelector: selector => selector({ loggedUser: { uid: 'user-1' }, selectedNavItem: 'noteProperties' }),
    useDispatch: () => mockDispatch,
}))
jest.mock('../../../../utils/redux/loadingOperation', () => ({
    beginLoadingOperation: () => mockFinishLoading,
    ACTION_LOADING_TIMEOUT_MS: 120000,
}))
jest.mock('../../../../URLSystem/Chats/URLsChats', () => ({
    __esModule: true,
    default: { push: jest.fn() },
    URL_CHAT_DETAILS_PROPERTIES: 'chat-properties',
}))
jest.mock('../../../../redux/actions', () => ({
    hideProjectPicker: () => ({ type: 'hide-project-picker' }),
    setSelectedNavItem: jest.fn(),
    setSelectedSidebarTab: jest.fn(),
    setSelectedTypeOfProject: jest.fn(),
    showConfirmPopup: jest.fn(value => value),
    switchProject: jest.fn(),
}))
jest.mock('../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    getTypeOfProject: () => 'active',
}))
jest.mock('../../../../utils/NavigationService', () => ({ navigate: jest.fn() }))
jest.mock('../../../../redux/store', () => ({ getState: () => ({ route: 'NotesDetailedView' }) }))
jest.mock('../../../../utils/performance/performanceLogger', () => ({
    startPerformanceTrace: () => ({ fail: jest.fn(), end: jest.fn() }),
}))
jest.mock('../../ConfirmPopup', () => ({ CONFIRM_POPUP_TRIGGER_INFO: 'info' }))
jest.mock('../../../../utils/backends/projectMoves', () => ({
    queueObjectProjectMove: (...args) => mockQueueMove(...args),
    waitForProjectMoveCompletion: (...args) => mockWaitForMove(...args),
}))
jest.mock('../../../../i18n/TranslationService', () => ({ translate: value => value }))

import useMoveObjectToProject from './useMoveObjectToProject'

const deferred = () => {
    let resolve
    let reject
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return { promise, resolve, reject }
}

describe('note project move progress', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('keeps the field pending after enqueue until the destination move completes', async () => {
        const queued = deferred()
        const completed = deferred()
        mockQueueMove.mockReturnValue(queued.promise)
        mockWaitForMove.mockReturnValue(completed.promise)
        const onNoteProjectMoveFinished = jest.fn()
        const { result } = renderHook(() => useMoveObjectToProject())

        await act(async () => {
            await result.current(
                { type: 'note', data: { id: 'note-1' } },
                { id: 'project-a' },
                { id: 'project-b', index: 1 },
                { onNoteProjectMoveFinished }
            )
        })
        expect(onNoteProjectMoveFinished).not.toHaveBeenCalled()

        await act(async () => queued.resolve({}))
        expect(mockWaitForMove).toHaveBeenCalledWith('project-a', 'project-b', 'note', 'note-1')
        expect(onNoteProjectMoveFinished).not.toHaveBeenCalled()

        await act(async () => completed.resolve({ id: 'note-1' }))
        expect(onNoteProjectMoveFinished).toHaveBeenCalledTimes(1)
        expect(mockFinishLoading).toHaveBeenCalledTimes(1)
    })

    it('clears field progress when the move fails', async () => {
        const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {})
        const queued = deferred()
        mockQueueMove.mockReturnValue(queued.promise)
        const onNoteProjectMoveFinished = jest.fn()
        const { result } = renderHook(() => useMoveObjectToProject())

        await act(async () => {
            await result.current(
                { type: 'note', data: { id: 'note-1' } },
                { id: 'project-a' },
                { id: 'project-b', index: 1 },
                { onNoteProjectMoveFinished }
            )
        })
        await act(async () => queued.reject(new Error('Move failed')))

        expect(onNoteProjectMoveFinished).toHaveBeenCalledTimes(1)
        expect(mockFinishLoading).toHaveBeenCalledTimes(1)
        errorLog.mockRestore()
    })
})
