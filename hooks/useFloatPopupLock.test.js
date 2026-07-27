import React, { useEffect } from 'react'
import renderer, { act } from 'react-test-renderer'

const mockDispatch = jest.fn()

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
}))
jest.mock('../redux/actions', () => ({
    showFloatPopup: () => ({ type: 'Show float popup' }),
    hideFloatPopup: () => ({ type: 'Hide float popup' }),
}))

import useFloatPopupLock, { createFloatPopupLock } from './useFloatPopupLock'

function PopupHarness() {
    const popupLock = useFloatPopupLock()

    useEffect(() => {
        popupLock.acquire()
    }, [])

    return null
}

describe('useFloatPopupLock', () => {
    beforeEach(() => {
        mockDispatch.mockClear()
    })

    test('releases an acquired popup lock when its owner unmounts', () => {
        let tree
        act(() => {
            tree = renderer.create(<PopupHarness />)
        })

        expect(mockDispatch).toHaveBeenCalledWith({ type: 'Show float popup' })

        act(() => {
            tree.unmount()
        })

        expect(mockDispatch).toHaveBeenLastCalledWith({ type: 'Hide float popup' })
    })

    test('only changes the global counter once for repeated acquire and release calls', () => {
        const popupLock = createFloatPopupLock(mockDispatch)

        popupLock.acquire()
        popupLock.acquire()
        popupLock.release()
        popupLock.release()

        expect(mockDispatch.mock.calls).toEqual([[{ type: 'Show float popup' }], [{ type: 'Hide float popup' }]])
    })
})
