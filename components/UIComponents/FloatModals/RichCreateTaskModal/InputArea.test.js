/**
 * PT-5424 — a popup opened by holding the board's floating "+" is a voice capture that closes again
 * on release, so its title input must never take focus: on a phone that focus is what opens the
 * software keyboard under the finger. A popup opened by a tap keeps focusing its input as before.
 */
import React from 'react'
import renderer, { act } from 'react-test-renderer'

const mockFocus = jest.fn()
let mockInputProps

jest.mock('../../../Feeds/CommentsTextInput/CustomTextInput3', () => {
    const React = require('react')
    return React.forwardRef((props, ref) => {
        mockInputProps = props
        React.useImperativeHandle(ref, () => ({ focus: mockFocus }))
        return null
    })
})
jest.mock('../../../Feeds/CommentsTextInput/textInputHelper', () => ({ CREATE_TASK_MODAL_THEME: 'create-task' }))

import InputArea from './InputArea'

const renderInput = props => {
    let tree
    act(() => {
        tree = renderer.create(<InputArea projectId="p1" task={{ name: '', extendedName: '' }} {...props} />)
    })
    return tree
}

describe('InputArea focus on open', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        mockFocus.mockClear()
        mockInputProps = null
    })
    afterEach(() => {
        jest.useRealTimers()
    })

    test('a tap-opened popup focuses its title input', () => {
        const tree = renderInput()
        expect(mockInputProps.autoFocus).toBe(true)

        act(() => {
            jest.advanceTimersByTime(1000)
        })
        expect(mockFocus).toHaveBeenCalledTimes(1)
        act(() => tree.unmount())
    })

    test('a hold-opened popup never focuses it, so no keyboard opens', () => {
        const handoff = { claim: jest.fn() }
        const tree = renderInput({ pushToTalkHandoff: handoff })
        expect(mockInputProps.autoFocus).toBe(false)
        expect(mockInputProps.pushToTalkHandoff).toBe(handoff)

        act(() => {
            jest.advanceTimersByTime(2000)
        })
        expect(mockFocus).not.toHaveBeenCalled()
        act(() => tree.unmount())
    })
})
