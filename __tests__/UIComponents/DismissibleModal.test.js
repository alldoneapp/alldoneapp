/**
 * @jest-environment jsdom
 */

import React from 'react'
import DismissibleModal from '../../components/UIComponents/DismissibleModal'
import { Platform } from 'react-native'
import store from '../../redux/store'

import {
    hideProjectColorPicker,
    showAddProjectOptions,
    showProjectColorPicker,
    toggleSmallScreen,
} from '../../redux/actions'

import renderer from 'react-test-renderer'

const emptyFunction = () => {}

const eventFunctions = {
    preventDefault: emptyFunction,
    stopPropagation: emptyFunction,
    persist: emptyFunction,
}

describe('DismissibleModal component', () => {
    describe('DismissibleModal empty snapshot test', () => {
        it('Should render correctly', () => {
            const tree = renderer.create(<DismissibleModal onDismiss={emptyFunction} />).toJSON()
            expect(tree).toMatchSnapshot()
        })

        xit('Should render correctly when the platform is web', () => {
            Platform.OS = 'web'
            const tree = renderer.create(<DismissibleModal onDismiss={emptyFunction} />).toJSON()
            expect(tree).toMatchSnapshot()
        })

        it('Should render correctly when the platform is web', () => {
            // Given
            store.dispatch(showAddProjectOptions())
            store.dispatch(showProjectColorPicker())
            renderer.create(<DismissibleModal onDismiss={emptyFunction} />)

            const isComponentVisible = store.getState().showAddProjectOptions.visible
            expect(isComponentVisible).toBe(true)

            // When
            DismissibleModal.captureDismissibleTouch({
                ...eventFunctions,
                nativeEvent: {
                    pageX: -10,
                    pageY: -10,
                },
            })

            // Then
            expect(store.getState().showAddProjectOptions.visible).toBe(false)
        })

        it('Should render correctly when the user clicks out of the project and color selector', () => {
            // Given
            store.dispatch(showAddProjectOptions())
            store.dispatch(hideProjectColorPicker())
            renderer.create(<DismissibleModal onDismiss={emptyFunction} />)

            const isComponentVisible = store.getState().showAddProjectOptions.visible
            expect(isComponentVisible).toBe(true)

            // When
            DismissibleModal.captureDismissibleTouch({
                ...eventFunctions,
                nativeEvent: {
                    pageX: -10,
                    pageY: -10,
                },
            })

            // Then
            expect(store.getState().showAddProjectOptions.visible).toBe(false)
        })
    })

    describe('test component methods call', () => {
        it('after call getDismissibleLimits should render correctly', () => {
            DismissibleModal.getDismissibleLimits()
        })

        it('after call captureDismissibleTouch should render correctly', () => {
            DismissibleModal.captureDismissibleTouch({
                ...eventFunctions,
                nativeEvent: {
                    pageX: 0,
                    pageY: 0,
                },
            })
        })

        it('after call captureDismissibleTouch should render correctly when is web', () => {
            Platform.OS = 'web'
            store.dispatch(toggleSmallScreen(true))
            DismissibleModal.captureDismissibleTouch({
                ...eventFunctions,
                nativeEvent: {
                    pageX: 0,
                    pageY: 0,
                },
            })
        })

        it('after call isTouchOutside should return true if coordinates are outside', () => {
            const res = DismissibleModal.isTouchOutside(20, 20, {
                x: 0,
                y: 0,
                width: 10,
                height: 10,
            })
            expect(res).toEqual(true)
        })

        it('after call isTouchOutside should return false if coordinates are inside', () => {
            const res = DismissibleModal.isTouchOutside(2, 2, {
                x: 0,
                y: 0,
                width: 10,
                height: 10,
            })
            expect(res).toEqual(false)
        })

        it('the result of getDismissibleLimits should be a Promise', async () => {
            store.dispatch({
                type: 'Set dismissible component',
                dismissibleComponent: null,
            })
            const res = DismissibleModal.getDismissibleLimits()
            expect(res).toBeInstanceOf(Promise)
        })
    })
})
