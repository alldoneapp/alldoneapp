/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet, TextInput } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import AssistantInputLine from './AssistantInputLine'

let mockState

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: key => key,
}))

jest.mock('../../../../utils/assistantHelper', () => ({
    createBotQuickTopic: jest.fn(),
}))

jest.mock('../../../MyDayView/AssistantLine/AssistantOptions/AssistantAvatarButton', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return () => <Text>Avatar</Text>
})

jest.mock('../../../UIComponents/Spinner', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return () => <Text>Spinner</Text>
})

jest.mock('../../../UIComponents/AssistantVoiceCallButton', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return ({ buttonStyle }) => <Text testID={'voice-call-button'} style={buttonStyle} />
})

jest.mock('../../../UIControls/Button', () => {
    const React = require('react')
    const { Text, TouchableOpacity } = require('react-native')
    return ({ title, onPress, accessibilityLabel, buttonStyle }) => (
        <TouchableOpacity onPress={onPress} accessibilityLabel={accessibilityLabel} style={buttonStyle}>
            <Text>{title || 'Button'}</Text>
        </TouchableOpacity>
    )
})

const assistant = { uid: 'assistant-1', displayName: 'Assistant' }

const renderLine = () => {
    let tree
    act(() => {
        tree = renderer.create(<AssistantInputLine assistant={assistant} projectId={'project-1'} />)
    })

    const getInput = () => tree.root.findByType(TextInput)
    const getControlsStyle = () =>
        StyleSheet.flatten(tree.root.findByProps({ testID: 'assistant-message-controls' }).props.style)
    const getInputHeight = () => StyleSheet.flatten(getInput().props.style).height
    const type = (text, contentHeight) => {
        act(() => getInput().props.onChangeText(text))
        if (contentHeight != null) {
            act(() => getInput().props.onContentSizeChange({ nativeEvent: { contentSize: { height: contentHeight } } }))
        }
    }

    return { tree, getInput, getControlsStyle, getInputHeight, type }
}

describe('AssistantInputLine control alignment', () => {
    beforeEach(() => {
        mockState = { smallScreenNavigation: false }
    })

    it('keeps the compact single row while the field is one line', () => {
        const { getControlsStyle, getInputHeight } = renderLine()

        expect(getControlsStyle().flexDirection).toBe('row')
        expect(getInputHeight()).toBe(40)
    })

    it('stacks the call and send buttons on one axis when the field expands', () => {
        const line = renderLine()
        line.type('A message long enough to wrap onto a second line', 62)

        const controls = line.getControlsStyle()
        expect(controls.flexDirection).toBe('column')
        expect(controls.alignItems).toBe('center')
        // No pinned width, so the flex:1 field expands into the freed space.
        expect(controls.width).toBeUndefined()
        // ...and the field matches the stacked cluster height (40 + 8 + 40).
        expect(line.getInputHeight()).toBe(88)
    })

    it('does not flap back to a row when the widened field re-wraps to one line', () => {
        const line = renderLine()

        line.type('A message long enough to wrap onto a second line', 62)
        expect(line.getControlsStyle().flexDirection).toBe('column')

        // The wider field now reports a single line again.
        line.type('A message long enough to wrap onto a second line', 40)
        expect(line.getControlsStyle().flexDirection).toBe('column')

        // Emptying the field is the only release condition.
        line.type('', null)
        expect(line.getControlsStyle().flexDirection).toBe('row')
        expect(line.getInputHeight()).toBe(40)
    })

    it('applies the same stacking on small screens', () => {
        mockState = { smallScreenNavigation: true }
        const line = renderLine()

        line.type('Mobile message that wraps', 62)

        const controls = line.getControlsStyle()
        expect(controls.flexDirection).toBe('column')
        expect(controls.alignItems).toBe('center')
        expect(line.getInputHeight()).toBe(88)
    })
})
