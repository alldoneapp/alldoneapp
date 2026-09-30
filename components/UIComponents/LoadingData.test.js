/**
 * @jest-environment jsdom
 */

import React from 'react'
import { Platform, StyleSheet } from 'react-native'
import LoadingData, { LOADING_DATA_SPINNER_DELAY_MS, LOADING_DATA_SPINNER_MIN_VISIBLE_MS } from './LoadingData'
import Spinner from './Spinner'

const mockState = {
    showLoadingDataSpinner: false,
    smallScreenNavigation: false,
    loggedUser: { isAnonymous: false, sidebarExpanded: true },
}
const mockSafeAreaInsets = { left: 0, bottom: 5 }
const mockIsAnnaMode = jest.fn(() => false)
jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))
jest.mock('../../hooks/useModalSizing', () => () => ({ safeAreaInsets: mockSafeAreaInsets }))
jest.mock('../../utils/annaMode', () => ({ isAnnaMode: () => mockIsAnnaMode() }))
jest.mock('./Spinner', () => 'Spinner')

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
        mockState.smallScreenNavigation = false
        mockState.loggedUser = { isAnonymous: false, sidebarExpanded: true }
        mockState.sidebarHovered = false
        mockSafeAreaInsets.left = 0
        mockSafeAreaInsets.bottom = 5
        mockIsAnnaMode.mockReturnValue(false)
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
                left: 287,
                bottom: 45,
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

    it('follows the content edge when the desktop sidebar collapses or is hovered', () => {
        const tree = renderLoadingData()
        setSpinnerRequested(tree, true)
        act(() => jest.advanceTimersByTime(LOADING_DATA_SPINNER_DELAY_MS))

        mockState.loggedUser.sidebarExpanded = false
        act(() => tree.update(<LoadingData />))
        const loaderStyle = () =>
            StyleSheet.flatten(tree.root.findByProps({ testID: 'loading-data-spinner' }).props.style)
        expect(loaderStyle().left).toBe(80)

        mockState.sidebarHovered = true
        act(() => tree.update(<LoadingData />))
        expect(loaderStyle().left).toBe(80)

        mockState.loggedUser.sidebarExpanded = true
        act(() => tree.update(<LoadingData />))
        expect(loaderStyle().left).toBe(287)
        act(() => tree.unmount())
    })

    it.each([
        ['phone', true, false, false, 0, 0, 24, 40],
        ['phone safe area', true, false, false, 0, 34, 24, 74],
        ['landscape safe area', true, false, false, 44, 21, 68, 61],
        ['anonymous desktop', false, true, false, 0, 0, 24, 40],
        ['Anna desktop', false, false, true, 0, 0, 24, 40],
    ])('keeps the compact loader inside the %s content area', (_, mobile, anonymous, anna, left, bottom, x, y) => {
        mockState.smallScreenNavigation = mobile
        mockState.loggedUser.isAnonymous = anonymous
        mockIsAnnaMode.mockReturnValue(anna)
        Object.assign(mockSafeAreaInsets, { left, bottom })
        const tree = renderLoadingData()
        setSpinnerRequested(tree, true)
        act(() => jest.advanceTimersByTime(LOADING_DATA_SPINNER_DELAY_MS))

        const style = StyleSheet.flatten(tree.root.findByProps({ testID: 'loading-data-spinner' }).props.style)
        expect(style).toMatchObject({ left: x, bottom: y, pointerEvents: 'none' })
        expect(style.right).toBeUndefined()
        expect(tree.root.findByType(Spinner).props).toMatchObject({ containerSize: 24, spinnerSize: 16 })
        act(() => tree.unmount())
    })
})
