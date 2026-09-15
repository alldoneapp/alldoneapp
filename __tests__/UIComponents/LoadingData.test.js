/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Platform, StyleSheet } from 'react-native'
import LoadingData, {
    LOADING_DATA_SPINNER_DELAY_MS,
    LOADING_DATA_SPINNER_MIN_VISIBLE_MS,
} from '../../components/UIComponents/LoadingData'
import Spinner from '../../components/UIComponents/Spinner'

const mockState = { showLoadingDataSpinner: false }
jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))
jest.mock('../../hooks/useModalSizing', () => () => ({ safeAreaInsets: { bottom: 5 } }))
jest.mock('../../components/UIComponents/Spinner', () => 'Spinner')

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

import renderer, { act } from 'react-test-renderer'

const renderLoadingData = () => renderer.create(<LoadingData />)

const setSpinnerRequested = (tree, requested) => {
    mockState.showLoadingDataSpinner = requested
    act(() => tree.update(<LoadingData />))
}

describe('LoadingData component', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        mockState.showLoadingDataSpinner = false
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    describe('LoadingData snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderLoadingData().toJSON()
            expect(tree).toMatchSnapshot()
        })
    })

    it('does not flash for a short loading operation', () => {
        const tree = renderLoadingData()

        setSpinnerRequested(tree, true)
        act(() => jest.advanceTimersByTime(LOADING_DATA_SPINNER_DELAY_MS - 1))
        setSpinnerRequested(tree, false)
        act(() => jest.advanceTimersByTime(LOADING_DATA_SPINNER_DELAY_MS + LOADING_DATA_SPINNER_MIN_VISIBLE_MS))

        expect(tree.root.findAllByType(Spinner)).toHaveLength(0)
        act(() => tree.unmount())
    })

    it('keeps a displayed spinner stable for a minimum duration', () => {
        const tree = renderLoadingData()

        setSpinnerRequested(tree, true)
        act(() => jest.advanceTimersByTime(LOADING_DATA_SPINNER_DELAY_MS))
        expect(tree.root.findAllByType(Spinner)).toHaveLength(1)
        expect(StyleSheet.flatten(tree.root.findByProps({ testID: 'loading-data-spinner' }).props.style)).toMatchObject(
            {
                position: 'fixed',
                left: 0,
                right: 0,
                bottom: 33,
                alignItems: 'center',
                pointerEvents: 'none',
            }
        )

        setSpinnerRequested(tree, false)
        act(() => jest.advanceTimersByTime(LOADING_DATA_SPINNER_MIN_VISIBLE_MS - 1))
        expect(tree.root.findAllByType(Spinner)).toHaveLength(1)

        act(() => jest.advanceTimersByTime(1))
        expect(tree.root.findAllByType(Spinner)).toHaveLength(0)
        act(() => tree.unmount())
    })
})
