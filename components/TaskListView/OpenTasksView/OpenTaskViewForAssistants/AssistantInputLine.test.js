/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import AssistantInputLine from './AssistantInputLine'

let mockState

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: key => key,
    getDeviceLanguage: () => 'en',
}))

jest.mock('../../../../utils/assistantHelper', () => ({
    createBotQuickTopic: jest.fn(),
}))

// AT-2444 swapped the plain TextInput for the rich editor so the line can take dropped files.
// Both stand-ins keep this suite about layout; the drop itself is covered against the REAL zone
// in AssistantInputLineAttachments.test.js.
jest.mock('../../../Feeds/CommentsTextInput/textInputHelper', () => ({
    TASK_THEME: 'TASK_THEME',
    insertFilesAsAttachments: jest.fn(() => ({ addedFiles: [], nextCursorIndex: 0 })),
}))

jest.mock('../../../Feeds/Utils/HelperFunctions', () => ({
    updateNewAttachmentsData: jest.fn(async (projectId, text) => text),
}))

jest.mock('../../../Feeds/CommentsTextInput/AttachmentDropZone', () => {
    const React = require('react')
    const { View } = require('react-native')
    return ({ children, style }) => <View style={style}>{children}</View>
})

const AssistantTextInputStub = 'AssistantTextInputStub'

jest.mock('../../../Feeds/CommentsTextInput/CustomTextInput3', () => {
    const React = require('react')
    return React.forwardRef((props, ref) => {
        React.useImperativeHandle(ref, () => ({
            clear: jest.fn(),
            blur: jest.fn(),
            isFocused: () => false,
        }))
        return React.createElement('AssistantTextInputStub', props)
    })
})

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

    const getInput = () => tree.root.findByType(AssistantTextInputStub)
    const getControlsStyle = () =>
        StyleSheet.flatten(tree.root.findByProps({ testID: 'assistant-message-controls' }).props.style)
    // The rich editor takes its height as a prop rather than through `style`.
    const getInputHeight = () => getInput().props.fixedHeight
    const type = (text, contentHeight) => {
        act(() => getInput().props.onChangeText(text))
        if (contentHeight != null) {
            act(() => getInput().props.onContentSizeChange(0, contentHeight))
        }
    }

    return { tree, getInput, getControlsStyle, getInputHeight, type }
}

describe('AssistantInputLine control alignment', () => {
    beforeEach(() => {
        mockState = { smallScreenNavigation: false }
    })

    it('keeps the compact single row while the field is one line', () => {
        const { getControlsStyle, getInputHeight, getInput } = renderLine()

        expect(getControlsStyle().flexDirection).toBe('row')
        expect(getInputHeight()).toBe(40)
        expect(getInput().props.placeholder).toBe('Start a new chat')
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

    // AT-2938: on a phone the controls stack too — Send above Call outside the field, + above the
    // mic inside it — so the wrapped text gets the freed width back.
    it('stacks Send above Call and + above the mic on mobile once the text wraps', () => {
        mockState = { smallScreenNavigation: true }
        const line = renderLine()
        const getVoiceStyle = () =>
            StyleSheet.flatten(line.tree.root.findByProps({ testID: 'voice-call-button' }).props.style)

        expect(line.getControlsStyle().flexDirection).toBe('row')
        expect(line.getInput().props.stackInlineControls).toBe(false)
        expect(line.getInputHeight()).toBe(40)
        expect(line.getInput().props.placeholder).toBe('New message …')

        line.type('Mobile message that wraps', 62)

        const controls = line.getControlsStyle()
        // column-reverse: the voice button is rendered first, so Send ends up on top.
        expect(controls.flexDirection).toBe('column-reverse')
        expect(controls.alignItems).toBe('center')
        expect(controls.width).toBeUndefined()
        // The gap sits between Send (above) and Call (below).
        expect(getVoiceStyle()).toEqual(expect.objectContaining({ marginTop: 8, marginBottom: 0, marginRight: 0 }))
        expect(line.getInput().props.stackInlineControls).toBe(true)
        // The field matches the stacked cluster height (40 + 8 + 40).
        expect(line.getInputHeight()).toBe(88)

        line.type('Long mobile message', 160)
        expect(line.getInputHeight()).toBe(120)
        expect(line.getControlsStyle().flexDirection).toBe('column-reverse')

        // The widened field re-wraps to one line: no flapping back to a row.
        line.type('Long mobile message', 40)
        expect(line.getControlsStyle().flexDirection).toBe('column-reverse')
        expect(line.getInput().props.stackInlineControls).toBe(true)

        // Emptying the field releases both clusters.
        line.type('', null)
        expect(line.getControlsStyle().flexDirection).toBe('row')
        expect(line.getInput().props.stackInlineControls).toBe(false)
        expect(line.getInputHeight()).toBe(40)
    })

    it('keeps Call above Send and the in-field controls in a row on desktop', () => {
        const line = renderLine()
        line.type('A message long enough to wrap onto a second line', 62)

        expect(line.getControlsStyle().flexDirection).toBe('column')
        expect(line.getInput().props.stackInlineControls).toBe(false)
    })
})
