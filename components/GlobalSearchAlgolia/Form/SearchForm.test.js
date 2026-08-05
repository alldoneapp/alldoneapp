/**
 * @jest-environment jsdom
 */

import React from 'react'
import { TextInput } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import SearchForm from './SearchForm'

jest.mock('../../UIControls/Button', () => 'Button')

describe('SearchForm', () => {
    it('submits the focused input on the first Enter without blurring it', () => {
        const onSubmitEditing = jest.fn()
        const searchInputRef = React.createRef()
        let component

        act(() => {
            component = renderer.create(
                <SearchForm
                    searchInputRef={searchInputRef}
                    onPressButton={jest.fn()}
                    onSubmitEditing={onSubmitEditing}
                    localText="invoice"
                    setLocalText={jest.fn()}
                />,
                { createNodeMock: () => ({ focus: jest.fn() }) }
            )
        })

        const input = component.root.findByType(TextInput)
        expect(input.props.blurOnSubmit).toBe(false)

        act(() => input.props.onSubmitEditing())
        expect(onSubmitEditing).toHaveBeenCalledTimes(1)

        act(() => component.unmount())
    })

    it('does not make the button action an implicit Enter action', () => {
        const onPressButton = jest.fn()
        let component

        act(() => {
            component = renderer.create(
                <SearchForm
                    searchInputRef={React.createRef()}
                    onPressButton={onPressButton}
                    localText="invoice"
                    setLocalText={jest.fn()}
                />,
                { createNodeMock: () => ({ focus: jest.fn() }) }
            )
        })

        const input = component.root.findByType(TextInput)
        expect(input.props.onSubmitEditing).toBeUndefined()
        expect(onPressButton).not.toHaveBeenCalled()

        act(() => component.unmount())
    })
})
