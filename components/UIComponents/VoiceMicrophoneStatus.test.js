import React from 'react'
import renderer, { act } from 'react-test-renderer'
import VoiceMicrophoneStatus from './VoiceMicrophoneStatus'

jest.mock('../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../Icon', () => 'Icon')
let tree
beforeEach(() => jest.useFakeTimers())
afterEach(() => {
    act(() => tree?.unmount())
    jest.useRealTimers()
})

test('shows the selected input, falling live levels and a device switch without rerendering its parent', () => {
    let input = { label: 'USB microphone', available: true, level: 0.25, sending: true }
    const read = jest.fn(() => input)
    const parent = jest.fn(() => <VoiceMicrophoneStatus read={read} />)
    act(() => {
        tree = renderer.create(React.createElement(parent))
    })
    const meter = () => tree.root.findByProps({ testID: 'voice-microphone-level' }).props
    expect(meter().accessibilityValue.now).toBe(50)
    input = { ...input, level: 0 }
    act(() => jest.advanceTimersByTime(100))
    expect(meter().accessibilityValue.now).toBe(0)
    input = { ...input, label: 'MacBook microphone', level: 0.64 }
    act(() => jest.advanceTimersByTime(100))
    expect(tree.root.findByProps({ testID: 'voice-microphone-name' }).props.children).toBe('MacBook microphone')
    expect(meter().accessibilityValue.now).toBe(80)
    expect(parent).toHaveBeenCalledTimes(1)
    act(() => tree.unmount())
    tree = null
    const calls = read.mock.calls.length
    act(() => jest.advanceTimersByTime(1000))
    expect(read).toHaveBeenCalledTimes(calls)
})

test('distinguishes local startup metering from transmission and clears muted or unavailable readings', () => {
    let input = { label: 'USB microphone', available: true, level: 0.36, sending: false }
    act(() => {
        tree = renderer.create(<VoiceMicrophoneStatus read={() => input} />)
    })
    const meter = () => tree.root.findByProps({ testID: 'voice-microphone-level' }).props
    expect(meter().accessibilityLabel).toBe('Microphone preview')
    expect(meter().accessibilityValue.now).toBe(60)
    input = { ...input, sending: true, muted: true }
    act(() => jest.advanceTimersByTime(100))
    expect(meter().accessibilityLabel).toBe('Microphone paused')
    expect(meter().accessibilityValue.now).toBe(0)
    input = { ...input, muted: false, available: false }
    act(() => jest.advanceTimersByTime(100))
    expect(meter().accessibilityValue.now).toBe(0)
})
