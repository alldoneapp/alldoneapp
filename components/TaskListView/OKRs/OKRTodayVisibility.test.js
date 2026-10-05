import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { createStore } from 'redux'

import OKRSection from './OKRSection'
import {
    SET_OKR_TODAY_OPERATION,
    reconcileOkrTodayOperations,
    reduceOkrTodayOperation,
} from '../../../redux/okrTodayVisibility'
import { setUserOKRHiddenInAllProjectsToday } from '../../../utils/backends/Users/usersFirestore'

let mockStore
const mockWrite = jest.fn()

jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: {
        getState: () => mockStore.getState(),
        dispatch: action => mockStore.dispatch(action),
    },
}))
jest.mock('../../../utils/backends/Users/usersFirestore', () => {
    const { persistOkrTodayVisibility } = require('../../../utils/backends/Users/okrTodayVisibility')
    return {
        setUserOKRHiddenInAllProjectsToday: (userId, projectId, okrId, day) =>
            persistOkrTodayVisibility(userId, projectId, [okrId], day, mockWrite),
        clearUserOKRHiddenInAllProjectsToday: (userId, projectId, okrId) =>
            persistOkrTodayVisibility(userId, projectId, [okrId], null, mockWrite),
        clearUserOKRsHiddenInAllProjectsToday: (userId, projectId, okrIds) =>
            persistOkrTodayVisibility(userId, projectId, okrIds, null, mockWrite),
    }
})
jest.mock('../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../../utils/SharedHelper', () => ({
    __esModule: true,
    default: { accessGranted: () => true },
}))
jest.mock('../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { checkIfLoggedUserIsNormalUserInGuide: () => false },
}))
jest.mock('../../../utils/NavigationService', () => ({ __esModule: true, default: {} }))
jest.mock('../../../utils/backends/OKRs/okrsFirestore', () => ({ updateOKRCurrentValue: jest.fn() }))
jest.mock('../../../utils/HelperFunctions', () => ({ popoverToSafePosition: jest.fn() }))
jest.mock(
    '../../UIComponents/ModalShell/AppPopover',
    () =>
        ({ children }) =>
            children
)
jest.mock('../../Icon', () => () => null)
jest.mock('./OKRModal', () => () => null)
jest.mock('./useOkrRevenueValue', () => () => ({ currentValue: 0, missingHourlyRate: false }))

const today = '2026-10-05'
const projectId = 'p1'
const userId = 'u1'
const okr = {
    id: 'o1',
    label: 'Ship the release',
    currentValue: 1,
    targetValue: 10,
    cadence: 'monthly',
    unit: '',
    periodStart: 1790812800000,
    periodEnd: 1793491200000,
    isPublicFor: [0],
}
const hiddenOkr = { ...okr, id: 'o2', label: 'Hidden OKR' }

const makeUser = (hidden = {}) => ({
    uid: userId,
    timezoneName: 'Europe/Berlin',
    okrsHiddenInAllProjectsTodayByProjectAndOkr: { [projectId]: hidden },
})
const makeState = (hidden = {}, okrs = [okr]) => ({
    loggedUser: makeUser(hidden),
    currentUser: { uid: userId },
    okrsByProjectInTasks: { [projectId]: okrs },
    okrTodayOperations: {},
    smallScreenNavigation: false,
})
const reducer = (state, action) => {
    if (action.type === SET_OKR_TODAY_OPERATION) return reduceOkrTodayOperation(state, action)
    if (action.type === 'snapshot')
        return {
            ...state,
            loggedUser: action.user,
            okrTodayOperations: reconcileOkrTodayOperations(state.okrTodayOperations, action.user),
        }
    if (action.type === 'mobile') return { ...state, smallScreenNavigation: true }
    return state
}
const snapshot = hidden => act(() => mockStore.dispatch({ type: 'snapshot', user: makeUser(hidden) }))
const mount = (inAllProjects = false) =>
    render(
        <Provider store={mockStore}>
            <OKRSection projectId={projectId} inAllProjects={inAllProjects} />
        </Provider>
    )
const doneButton = () => screen.getByLabelText('Hide OKR in All Projects for today')
const undoButton = () => screen.getByLabelText('Undo all OKRs for today')
const expectDisabled = button => expect(button.getAttribute('aria-disabled')).toBe('true')

describe('OKR today visibility with delayed persistence and snapshots', () => {
    let resolveWrite
    let rejectWrite
    beforeEach(() => {
        jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-05T08:00:00Z'))
        mockStore = createStore(reducer, makeState())
        mockWrite.mockReset()
        mockWrite.mockImplementation(
            () =>
                new Promise((resolve, reject) => {
                    resolveWrite = resolve
                    rejectWrite = reject
                })
        )
    })
    afterEach(() => jest.restoreAllMocks())

    it.each([false, true])(
        'immediately shows pending feedback, retaining the row until acknowledgement (All Projects: %s)',
        async inAllProjects => {
            mount(inAllProjects)
            fireEvent.click(doneButton())
            expect(screen.getByText('OKR saving today visibility')).toBeTruthy()
            expectDisabled(doneButton())
            fireEvent.click(doneButton())
            await expect(setUserOKRHiddenInAllProjectsToday(userId, projectId, okr.id, today)).resolves.toBe(false)
            expect(mockWrite).toHaveBeenCalledTimes(1)

            // Firestore latency compensation must not look like server success.
            snapshot({ [okr.id]: today })
            expect(screen.getByText(okr.label)).toBeTruthy()
            expect(screen.getByText('OKR saving today visibility')).toBeTruthy()
            await act(async () => resolveWrite())
            expect(screen.queryByText(okr.label)).toBeNull()
            expect(Object.keys(mockStore.getState().okrTodayOperations)).toHaveLength(0)
        }
    )

    it('hides on acknowledgement even when the Redux user listener lags, then reconciles', async () => {
        mount()
        fireEvent.click(doneButton())
        await act(async () => resolveWrite())
        expect(screen.queryByText(okr.label)).toBeNull()
        expect(Object.values(mockStore.getState().okrTodayOperations)[0].status).toBe('saved')
        snapshot({ [okr.id]: today })
        expect(Object.keys(mockStore.getState().okrTodayOperations)).toHaveLength(0)
        snapshot({}) // A subsequent restore from another device must be respected.
        expect(screen.getByText(okr.label)).toBeTruthy()
    })

    it('displays rejection, preserves the row through a delayed rollback, and allows retry', async () => {
        mount()
        fireEvent.click(doneButton())
        snapshot({ [okr.id]: today })
        await act(async () => rejectWrite(new Error('permission-denied')))
        expect(screen.getByRole('alert').textContent).toBe('OKR today visibility failed')
        expect(screen.getByText(okr.label)).toBeTruthy()
        expect(screen.getByText('Retry')).toBeTruthy()
        expect(doneButton().getAttribute('aria-disabled')).not.toBe('true')
        snapshot({})
        fireEvent.click(doneButton())
        expect(mockWrite).toHaveBeenCalledTimes(2)
        expect(screen.queryByRole('alert')).toBeNull()
        await act(async () => resolveWrite())
        expect(screen.queryByText(okr.label)).toBeNull()
    })

    it('retains pending feedback and duplicate protection across navigation, including mobile', async () => {
        const view = mount()
        fireEvent.click(doneButton())
        view.unmount()
        mockStore.dispatch({ type: 'mobile' })
        mount(true)
        expectDisabled(doneButton())
        expect(screen.getByText('OKR saving today visibility')).toBeTruthy()
        fireEvent.click(doneButton())
        expect(mockWrite).toHaveBeenCalledTimes(1)
        await act(async () => rejectWrite(new Error('unavailable')))
        expect(screen.getByRole('alert')).toBeTruthy()
    })

    it('keeps different OKRs independent and disables undo during pending hides', async () => {
        mockStore = createStore(reducer, makeState({ [hiddenOkr.id]: today }, [okr, hiddenOkr]))
        mount()
        fireEvent.click(doneButton())
        expectDisabled(undoButton())
        fireEvent.click(undoButton())
        expect(mockWrite).toHaveBeenCalledTimes(1)
        snapshot({ [okr.id]: today, [hiddenOkr.id]: today })
        await act(async () => rejectWrite(new Error('unavailable')))
        snapshot({ [hiddenOkr.id]: today })
        expect(screen.getByText(okr.label)).toBeTruthy()
        expect(screen.queryByText(hiddenOkr.label)).toBeNull()
    })

    it('can save separate rows concurrently without one failure rolling back the other', async () => {
        const writes = []
        mockWrite.mockImplementation(() => new Promise((resolve, reject) => writes.push({ resolve, reject })))
        mockStore = createStore(reducer, makeState({}, [okr, hiddenOkr]))
        mount()
        const buttons = screen.getAllByLabelText('Hide OKR in All Projects for today')
        fireEvent.click(buttons[0])
        fireEvent.click(buttons[1])
        expect(mockWrite).toHaveBeenCalledTimes(2)
        snapshot({ [okr.id]: today, [hiddenOkr.id]: today })
        await act(async () => {
            writes[0].resolve()
            writes[1].reject(new Error('permission-denied'))
        })
        expect(screen.queryByText(okr.label)).toBeNull()
        expect(screen.getByText(hiddenOkr.label)).toBeTruthy()
        expect(screen.getByRole('alert')).toBeTruthy()
    })

    it('does not leak a pending operation to another user or turn yesterday into done today', async () => {
        mount()
        fireEvent.click(doneButton())
        act(() => mockStore.dispatch({ type: 'snapshot', user: { ...makeUser(), uid: 'u2' } }))
        expect(screen.queryByText('OKR saving today visibility')).toBeNull()
        expect(doneButton().getAttribute('aria-disabled')).not.toBe('true')
        await act(async () => resolveWrite())
        expect(screen.getByText(okr.label)).toBeTruthy()
        jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-06T08:00:00Z'))
        snapshot({ [okr.id]: today })
        expect(screen.getByText(okr.label)).toBeTruthy()
    })

    it('shows undo pending, ignores optimistic restoration, and reveals rows after acknowledgement', async () => {
        mockStore = createStore(reducer, makeState({ [hiddenOkr.id]: today }, [okr, hiddenOkr]))
        mount()
        fireEvent.click(undoButton())
        expectDisabled(undoButton())
        expect(screen.getAllByText('OKR saving today visibility').length).toBeGreaterThan(0)
        fireEvent.click(undoButton())
        expect(mockWrite).toHaveBeenCalledTimes(1)
        snapshot({})
        expect(screen.queryByText(hiddenOkr.label)).toBeNull()
        await act(async () => resolveWrite())
        expect(screen.getByText(hiddenOkr.label)).toBeTruthy()
    })

    it('keeps failed undo visible and retryable without falsely restoring OKRs', async () => {
        mockStore = createStore(reducer, makeState({ [hiddenOkr.id]: today }, [okr, hiddenOkr]))
        mount()
        fireEvent.click(undoButton())
        snapshot({})
        await act(async () => rejectWrite(new Error('permission-denied')))
        expect(screen.getByRole('alert')).toBeTruthy()
        expect(screen.queryByText(hiddenOkr.label)).toBeNull()
        snapshot({ [hiddenOkr.id]: today })
        fireEvent.click(undoButton())
        expect(mockWrite).toHaveBeenCalledTimes(2)
        await act(async () => resolveWrite())
        await waitFor(() => expect(screen.getByText(hiddenOkr.label)).toBeTruthy())
    })
})
