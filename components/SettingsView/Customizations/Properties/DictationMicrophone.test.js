/**
 * @jest-environment jsdom
 *
 * Settings → Customizations → "Dictation microphone" (AT-2357): the escape hatch from the automatic
 * silent-mic workaround. What matters here is that an explicit choice is persisted and that
 * "Automatic" admits when it has actually switched something — the workaround is otherwise
 * invisible, which is exactly how the original bug went unnoticed for so long.
 */
import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text, TouchableOpacity } from 'react-native'

import DictationMicrophone from './DictationMicrophone'
import {
    MIC_MODE_AUTO,
    MIC_MODE_COMPATIBILITY,
    MIC_MODE_STANDARD,
    readLearnedCaptureMode,
    readMicModeSetting,
    rememberLearnedCaptureMode,
} from '../../../../hooks/rambleMicCapture'

jest.mock('react-redux', () => ({
    useSelector: jest.fn(selector => selector({ smallScreen: false })),
}))

jest.mock('../../../Icon', () => 'Icon')
jest.mock('../../../../i18n/TranslationService', () => ({
    translate: jest.fn(text => text),
}))
jest.mock('../../../UIComponents/ModalShell/AppPopover', () => {
    const React = require('react')
    // Render trigger AND content so the options are reachable without driving the popover.
    return ({ children, content }) => React.createElement(React.Fragment, null, children, content)
})
jest.mock('../../../UIControls/Button', () => {
    const React = require('react')
    const { Text, TouchableOpacity } = require('react-native')
    return ({ title, onPress }) =>
        React.createElement(TouchableOpacity, { onPress }, React.createElement(Text, null, title))
})

const renderRow = () => renderer.create(<DictationMicrophone />).root

const selectOption = (tree, label) => {
    const option = tree
        .findAllByType(TouchableOpacity)
        .find(node => node.findAllByType(Text).some(text => text.props.children === label))
    act(() => {
        option.props.onPress()
    })
}

afterEach(() => {
    localStorage.clear()
})

describe('DictationMicrophone', () => {
    test('defaults to Automatic and says nothing about a workaround that never engaged', () => {
        const tree = renderRow()
        const labels = tree.findAllByType(Text).map(node => node.props.children)

        expect(labels).toContain('Automatic')
        expect(labels.join(' ')).not.toContain('compatibility in use')
    })

    test('Automatic reports when it has switched to compatibility capture', () => {
        rememberLearnedCaptureMode({ deviceId: 'webcam-1', deviceLabel: 'HD Webcam' })
        const tree = renderRow()

        const labels = tree.findAllByType(Text).map(node => node.props.children)
        expect(labels.join(' ')).toContain('compatibility in use')
    })

    test('choosing Standard turns the workaround off and forgets what was learned', () => {
        rememberLearnedCaptureMode({ deviceId: 'webcam-1' })
        const tree = renderRow()

        selectOption(tree, 'Standard (noise suppression on)')

        expect(readMicModeSetting()).toBe(MIC_MODE_STANDARD)
        expect(readLearnedCaptureMode()).toBeNull()
        const labels = tree.findAllByType(Text).map(node => node.props.children)
        expect(labels.join(' ')).not.toContain('compatibility in use')
    })

    test('compatibility can be forced, and Automatic can be restored', () => {
        const tree = renderRow()

        selectOption(tree, 'Compatibility (noise suppression off)')
        expect(readMicModeSetting()).toBe(MIC_MODE_COMPATIBILITY)

        selectOption(tree, 'Automatic')
        expect(readMicModeSetting()).toBe(MIC_MODE_AUTO)
    })
})
