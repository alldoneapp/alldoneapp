/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Provider } from 'react-redux'
import store from '../../redux/store'
import { Platform } from 'react-native'
import LoadingData, {
    LOADING_DATA_SPINNER_DELAY_MS,
    LOADING_DATA_SPINNER_MIN_VISIBLE_MS,
} from '../../components/UIComponents/LoadingData'
import Spinner from '../../components/UIComponents/Spinner'
import { resetLoadingData, startLoadingData, stopLoadingData } from '../../redux/actions'

// MyPlatform.osType only consults window.navigator off the mobile path,
// and the react-native preset reports ios.
Platform.OS = 'web'

import renderer, { act } from 'react-test-renderer'

const renderLoadingData = () =>
    renderer.create(
        <Provider store={store}>
            <LoadingData />
        </Provider>
    )

describe('LoadingData component', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        store.dispatch(resetLoadingData())
    })

    afterEach(() => {
        store.dispatch(resetLoadingData())
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

        act(() => store.dispatch(startLoadingData()))
        act(() => jest.advanceTimersByTime(LOADING_DATA_SPINNER_DELAY_MS - 1))
        act(() => store.dispatch(stopLoadingData()))
        act(() => jest.advanceTimersByTime(LOADING_DATA_SPINNER_DELAY_MS + LOADING_DATA_SPINNER_MIN_VISIBLE_MS))

        expect(tree.root.findAllByType(Spinner)).toHaveLength(0)
        act(() => tree.unmount())
    })

    it('keeps a displayed spinner stable for a minimum duration', () => {
        const tree = renderLoadingData()

        act(() => store.dispatch(startLoadingData()))
        act(() => jest.advanceTimersByTime(LOADING_DATA_SPINNER_DELAY_MS))
        expect(tree.root.findAllByType(Spinner)).toHaveLength(1)

        act(() => store.dispatch(stopLoadingData()))
        act(() => jest.advanceTimersByTime(LOADING_DATA_SPINNER_MIN_VISIBLE_MS - 1))
        expect(tree.root.findAllByType(Spinner)).toHaveLength(1)

        act(() => jest.advanceTimersByTime(1))
        expect(tree.root.findAllByType(Spinner)).toHaveLength(0)
        act(() => tree.unmount())
    })
})
