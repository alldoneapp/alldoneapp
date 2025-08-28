/**
 * @jest-environment jsdom
 */

import React from 'react'
import { toggleSmallScreen } from '../../redux/actions'
import store from '../../redux/store'
import ActionButton from '../../components/FeedView/ActionButton'

import renderer from 'react-test-renderer'
import { render, fireEvent } from 'react-native-testing-library';

describe('ActionButton component', () => {
    it('should render correctly', () => {
        const json = renderer.create(<ActionButton icon={{ icon: null }} text={{ text: null }} />).toJSON()
        expect(json).toMatchSnapshot()
    })

    it('should unmount correctly', () => {
        const tree = renderer.create(<ActionButton icon={{ icon: null }} text={{ text: null }} />)
        tree.unmount()
    })

    it('should updateState correctly', () => {
        // Given
        const expectedValue = true
        store.dispatch(toggleSmallScreen(expectedValue))
        const tree = renderer.create(<ActionButton icon={{ icon: null }} text={{ text: null }} />)
        const instance = tree.getInstance()
        // When
        instance.updateState()
        // Then
        expect(instance.state.smallScreen).toEqual(expectedValue)
    })

    it('should invoke onPress correctly', () => {
        // Given
        const mockFn = jest.fn()
        const { getByTestId } = render(
            <ActionButton icon={{ icon: null }} text={{ text: null }} onPress={mockFn} />
        );
        const touchableOpacity = getByTestId('touchableOpacity')
        // When
        fireEvent.press(touchableOpacity)
        // Then
        expect(mockFn).toBeCalledTimes(1)
    })

    it('should not invoke onPress', () => {
        // Given
        const mockFn = jest.fn()
        const { getByTestId } = render(
            <ActionButton icon={{ icon: null }} text={{ text: null }}/>
        );
        const touchableOpacity = getByTestId('touchableOpacity')
        // When
        fireEvent.press(touchableOpacity)
        // Then
        expect(mockFn).toBeCalledTimes(0)
    })

    it('should hide the Popover', () => {
        // Given
        const tree = renderer.create(<ActionButton icon={{ icon: null }} text={{ text: null }} />)
        const instance = tree.getInstance()
        instance.state.visiblePopover = true
        // When
        instance.hidePopover()
        // Then
        setTimeout(()=> {
            expect(instance.state.visiblePopover).toEqual(false)
        }, 1000)
    })
})
