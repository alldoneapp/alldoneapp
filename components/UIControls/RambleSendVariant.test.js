/**
 * @jest-environment jsdom
 *
 * AT-3025: the mic an empty composer shows in its send button's place is the ordinary RambleButton
 * drawn blue and send-sized while idle, and the ordinary red timer chip while it records.
 */
import React from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

let mockRecording = false

jest.mock('../../hooks/useRambleRecorder', () => ({
    __esModule: true,
    default: jest.fn(() => ({
        isRecording: mockRecording,
        elapsedSeconds: 3,
        start: jest.fn(),
        stop: jest.fn(),
        cancel: jest.fn(),
        getInputLevel: jest.fn(() => 0),
    })),
}))
jest.mock('../../hooks/useEscapeKey', () => jest.fn())
jest.mock('../Icon', () => 'Icon')
jest.mock('../../i18n/TranslationService', () => ({ translate: jest.fn(key => key) }))
jest.mock('../../utils/backends/Rambler/ramblerBackend', () => ({ processRamble: jest.fn() }))
jest.mock('../../redux/store', () => ({ getState: () => ({ loggedUser: {} }), dispatch: jest.fn() }))
jest.mock('../../redux/actions', () => ({ setShowLimitedFeatureModal: jest.fn() }))
jest.mock('../UIComponents/Ghosts/ghostAnimation', () => ({ useReducedMotion: () => false }))

const RambleButton = require('./RambleButton').default
const { colors } = require('../styles/global')

const render = props => {
    let tree
    act(() => {
        tree = renderer.create(<RambleButton projectId="p1" onTextReady={jest.fn()} onSubmit={jest.fn()} {...props} />)
    })
    return tree
}
const button = tree => tree.root.findByType(TouchableOpacity)
const style = tree => StyleSheet.flatten(button(tree).props.style)
const icon = tree => tree.root.findByType('Icon').props

afterEach(() => {
    mockRecording = false
})

describe('RambleButton send variant (AT-3025)', () => {
    it('is a blue button with a white mic while idle, sized by the host', () => {
        const tree = render({ variant: 'send', testID: 'send-mic', style: { minWidth: 36, height: 36 } })
        expect(style(tree)).toEqual(
            expect.objectContaining({ backgroundColor: colors.Primary300, minWidth: 36, height: 36 })
        )
        expect(icon(tree)).toEqual(expect.objectContaining({ name: 'mic', color: '#ffffff', size: 20 }))
        expect(button(tree).props.testID).toBe('send-mic')
        expect(button(tree).props.accessibilityLabel).toBe('Dictate')
    })

    it('takes a host blue for the idle look only', () => {
        const tree = render({ variant: 'send', sendIdleStyle: { backgroundColor: colors.Primary200 } })
        expect(style(tree).backgroundColor).toBe(colors.Primary200)
    })

    it('records with the same red timer chip as the quiet mic', () => {
        mockRecording = true
        const tree = render({ variant: 'send', sendIdleStyle: { backgroundColor: colors.Primary200 } })
        expect(style(tree).backgroundColor).toBe(colors.Grey100)
        expect(icon(tree).color).toBe(colors.Red200)
        expect(button(tree).props.accessibilityLabel).toBe('Stop dictation')
    })

    it('leaves the quiet mic unchanged', () => {
        const tree = render({})
        expect(style(tree).backgroundColor).toBeUndefined()
        expect(icon(tree)).toEqual(expect.objectContaining({ color: colors.Text03, size: 16 }))
    })

    it('stays hidden while idle and not visible, but keeps showing a take in progress', () => {
        expect(render({ variant: 'send', visible: false }).toJSON()).toBeNull()
        mockRecording = true
        expect(render({ variant: 'send', visible: false }).toJSON()).not.toBeNull()
    })
})
