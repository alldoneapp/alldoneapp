/**
 * @jest-environment jsdom
 *
 * Settings → Customizations → "Dictation microphone" (AT-2357): the escape hatch from the automatic
 * silent-mic workaround, and the only way to overrule the browser's own microphone choice. What
 * matters here is that an explicit choice — of device or of capture mode — is persisted, and that
 * "Automatic" admits when it has actually switched something: the workaround is otherwise
 * invisible, which is exactly how the original bug went unnoticed for so long.
 */
import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text, TouchableOpacity } from 'react-native'

import DictationMicrophone, { SYSTEM_DEFAULT_OPTION_LABEL } from './DictationMicrophone'
import {
    MIC_MODE_AUTO,
    MIC_MODE_COMPATIBILITY,
    MIC_MODE_STANDARD,
    readLearnedCaptureMode,
    readLearnedInputDevice,
    readMicModeSetting,
    readPreferredInputDevice,
    rememberLastUsedInputDevice,
    rememberLearnedCaptureMode,
    rememberLearnedInputDevice,
    writePreferredInputDevice,
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

    test('lists the browser audio inputs and persists an explicit choice', async () => {
        const original = navigator.mediaDevices
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: {
                enumerateDevices: async () => [
                    { kind: 'audioinput', deviceId: 'builtin-1', label: 'MacBook Pro Microphone', groupId: 'g1' },
                    { kind: 'audioinput', deviceId: 'webcam-1', label: 'HD Webcam', groupId: 'g2' },
                    { kind: 'videoinput', deviceId: 'cam-1', label: 'Camera', groupId: 'g2' },
                ],
            },
        })

        let instance
        await act(async () => {
            instance = renderer.create(<DictationMicrophone />)
        })
        const tree = instance.root
        // The list is only enumerated when the picker is opened, so a settings screen never touches
        // the microphone on mount.
        await act(async () => {
            tree.findAllByType(TouchableOpacity)[0].props.onPress()
        })

        const labels = tree.findAllByType(Text).map(node => node.props.children)
        expect(labels).toContain('HD Webcam')
        expect(labels).not.toContain('Camera')

        selectOption(tree, 'HD Webcam')
        expect(readPreferredInputDevice()).toEqual({ deviceId: 'webcam-1', label: 'HD Webcam' })

        // Back to letting the browser decide.
        selectOption(tree, SYSTEM_DEFAULT_OPTION_LABEL)
        expect(readPreferredInputDevice()).toBeNull()

        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: original })
    })

    test('says which device "System default" actually resolved to', () => {
        // The reporting user could not open DevTools, and a browser pinned to the wrong microphone
        // is invisible from inside the page — so the last device we really recorded from is the only
        // way for him to see that "System default" means the built-in mic.
        rememberLastUsedInputDevice({ deviceId: 'builtin-1', label: 'MacBook Pro Microphone' })
        const tree = renderRow()

        const labels = tree.findAllByType(Text).map(node => node.props.children)
        expect(labels.join(' ')).toContain('MacBook Pro Microphone')
    })

    test('an explicit device replaces the resolved-default hint rather than adding to it', () => {
        rememberLastUsedInputDevice({ deviceId: 'builtin-1', label: 'MacBook Pro Microphone' })
        writePreferredInputDevice({ deviceId: 'webcam-1', label: 'HD Webcam' })
        const tree = renderRow()

        const labels = tree
            .findAllByType(Text)
            .map(node => node.props.children)
            .join(' ')
        expect(labels).toContain('HD Webcam')
        expect(labels).not.toContain('MacBook Pro Microphone')
    })

    test('choosing a device by hand retires what automatic had learned', async () => {
        rememberLearnedInputDevice({ deviceId: 'builtin-1', label: 'MacBook Pro Microphone' })
        rememberLearnedCaptureMode({ deviceId: 'builtin-1' })
        const tree = renderRow()

        // No enumeration needed: the row itself must still be able to hand control back.
        selectOption(tree, SYSTEM_DEFAULT_OPTION_LABEL)

        expect(readLearnedInputDevice()).toBeNull()
        expect(readLearnedCaptureMode()).toBeNull()
    })

    test('compatibility can be forced, and Automatic can be restored', () => {
        const tree = renderRow()

        selectOption(tree, 'Compatibility (noise suppression off)')
        expect(readMicModeSetting()).toBe(MIC_MODE_COMPATIBILITY)

        selectOption(tree, 'Automatic')
        expect(readMicModeSetting()).toBe(MIC_MODE_AUTO)
    })
})
