import store from '../redux/store'
import { setCheckTaskItem, setFocusedTaskItem, unsetActiveEditMode, updateAllSelectedTasks } from '../redux/actions'
import { protectModalDismissFromClickThrough, registerPopupDismiss } from './popupDismissGuard'
import { prepareTaskFocusChange } from './taskFocusInteraction'

jest.mock('../redux/store', () => ({
    dispatch: jest.fn(),
}))

jest.mock('../redux/actions', () => ({
    setCheckTaskItem: jest.fn(() => ({ type: 'clear-check-task' })),
    setFocusedTaskItem: jest.fn(() => ({ type: 'clear-focused-task' })),
    unsetActiveEditMode: jest.fn(() => ({ type: 'clear-edit-mode' })),
    updateAllSelectedTasks: jest.fn(() => ({ type: 'clear-selected-tasks' })),
}))

jest.mock('./popupDismissGuard', () => ({
    protectModalDismissFromClickThrough: jest.fn(),
    registerPopupDismiss: jest.fn(),
}))

describe('prepareTaskFocusChange', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('clears every task selection and edit state before dismissing the editor', () => {
        const event = { nativeEvent: { type: 'touchend' } }
        const dismissEditMode = jest.fn()

        prepareTaskFocusChange(event, dismissEditMode)

        expect(registerPopupDismiss).toHaveBeenCalledTimes(1)
        expect(protectModalDismissFromClickThrough).toHaveBeenCalledWith(event)
        expect(updateAllSelectedTasks).toHaveBeenCalledWith([])
        expect(setCheckTaskItem).toHaveBeenCalledWith('', false)
        expect(setFocusedTaskItem).toHaveBeenCalledWith('', false)
        expect(unsetActiveEditMode).toHaveBeenCalledTimes(1)
        expect(store.dispatch).toHaveBeenCalledWith([
            { type: 'clear-selected-tasks' },
            { type: 'clear-check-task' },
            { type: 'clear-focused-task' },
            { type: 'clear-edit-mode' },
        ])
        expect(dismissEditMode).toHaveBeenCalledWith(true)
        expect(store.dispatch.mock.invocationCallOrder[0]).toBeLessThan(dismissEditMode.mock.invocationCallOrder[0])
    })

    test('can clear stale list state from a non-list focus control', () => {
        prepareTaskFocusChange()

        expect(store.dispatch).toHaveBeenCalledTimes(1)
        expect(protectModalDismissFromClickThrough).toHaveBeenCalledWith(undefined)
    })
})
