import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import AnnaCallAudioControls from './AnnaCallAudioControls'

jest.mock('../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../Icon', () => () => null)
let root, container, call, input, output, devices
beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    jest.useFakeTimers()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    input = { label: 'USB microphone', selectedDeviceId: '', available: true, level: 0.25 }
    output = { available: true, level: 0.64 }
    devices = {
        supportsInputSelection: true,
        supportsOutputSelection: true,
        supportsOutputPrompt: true,
        inputDevices: [{ deviceId: 'usb', label: 'USB microphone' }],
        outputDevices: [{ deviceId: 'headphones', label: 'Headphones' }],
        outputDeviceId: '',
    }
    call = {
        status: 'connected',
        getMicrophoneSnapshot: () => input,
        getOutputSnapshot: () => output,
        getAudioDevicesSnapshot: () => devices,
        selectMicrophone: jest.fn(async id => {
            input = { ...input, selectedDeviceId: id }
        }),
        selectAudioOutput: jest.fn(async id => {
            devices = { ...devices, outputDeviceId: id }
        }),
    }
})
afterEach(() => {
    act(() => root.unmount())
    container.remove()
    jest.useRealTimers()
})
const render = () => act(() => root.render(<AnnaCallAudioControls call={call} />))
const openSettings = () => act(() => container.querySelector('button[aria-label="Audio settings"]').click())
const tick = () => act(() => jest.advanceTimersByTime(100))
const select = async (label, value) =>
    act(async () => {
        const node = document.querySelector(`select[aria-label="${label}"]`)
        node.value = value
        node.dispatchEvent(new Event('change', { bubbles: true }))
    })

test('independent live meters fall to silence and stay zero when muted or unavailable without rerendering the parent', () => {
    const parent = jest.fn(() => <AnnaCallAudioControls call={call} />)
    act(() => root.render(React.createElement(parent)))
    const values = () =>
        [...container.querySelectorAll('[role="progressbar"]')].map(node => node.getAttribute('aria-valuenow'))
    expect(values()).toEqual(['50', '80'])
    const parentRenders = parent.mock.calls.length
    input.level = 0
    output.level = 0.09
    tick()
    expect(values()).toEqual(['0', '30'])
    input = { ...input, level: 1, muted: true }
    output = { ...output, level: 1, available: false }
    tick()
    expect(values()).toEqual(['0', '0'])
    expect(parent).toHaveBeenCalledTimes(parentRenders)
    expect(container.querySelector('[aria-label="Audio output level"]').getAttribute('aria-valuetext')).toBe(
        'Audio level unavailable'
    )
})

test('switches input and output without submitting the containing form and reflects confirmed selections', async () => {
    render()
    openSettings()
    await select('Audio input', 'usb')
    tick()
    expect(call.selectMicrophone).toHaveBeenCalledWith('usb')
    expect(document.querySelector('select[aria-label="Audio input"]').value).toBe('usb')
    await select('Audio output', 'headphones')
    tick()
    expect(call.selectAudioOutput).toHaveBeenCalledWith('headphones')
    expect(document.querySelector('select[aria-label="Audio output"]').value).toBe('headphones')
    await select('Audio output', 'choose')
    expect(call.selectAudioOutput).toHaveBeenLastCalledWith('choose')
})

test('shows a failed switch without changing the confirmed device or blocking hangup elsewhere', async () => {
    call.selectMicrophone.mockRejectedValue(new Error('Device busy'))
    render()
    openSettings()
    await select('Audio input', 'usb')
    expect(container.querySelector('[role="alert"]').textContent).toBe('Could not change microphone')
    expect(document.querySelector('select[aria-label="Audio input"]').value).toBe('')
    expect(document.querySelector('select[aria-label="Audio input"]').disabled).toBe(false)
})

test('platforms without selection retain both meters and explain system routing; ending disables selectors', () => {
    devices.supportsInputSelection = devices.supportsOutputSelection = false
    render()
    expect(container.querySelector('select')).toBeNull()
    openSettings()
    expect(document.body.textContent).toContain('Choose audio devices in your browser or system settings')
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(2)
    devices.supportsInputSelection = devices.supportsOutputSelection = true
    call.status = 'ending'
    render()
    tick()
    expect([...document.querySelectorAll('select')].every(node => node.disabled)).toBe(true)
})

test('updates device options after hotplug and stops polling when the call controls unmount', () => {
    const read = jest.spyOn(call, 'getMicrophoneSnapshot')
    render()
    openSettings()
    devices.inputDevices.push({ deviceId: 'new', label: 'New microphone' })
    tick()
    expect(document.body.textContent).toContain('New microphone')
    act(() => root.unmount())
    const reads = read.mock.calls.length
    tick()
    expect(read).toHaveBeenCalledTimes(reads)
})

test('vertical meters expose direction and state, clamp levels, and immediately reflect call mute', () => {
    input.level = 4
    output.level = -1
    render()
    const meters = [...container.querySelectorAll('[role="progressbar"]')]
    expect(meters.map(node => node.getAttribute('aria-orientation'))).toEqual(['vertical', 'vertical'])
    expect(meters.map(node => node.firstChild.style.height)).toEqual(['100%', '0%'])
    call.microphoneMuted = true
    render()
    expect(meters[0].getAttribute('aria-valuenow')).toBe('0')
    expect(meters[0].getAttribute('aria-valuetext')).toBe('Microphone muted')
    call.microphoneMuted = false
    input.level = NaN
    output.level = Infinity
    render()
    tick()
    expect(meters.map(node => node.getAttribute('aria-valuenow'))).toEqual(['0', '0'])
})

test('settings close restores focus; device switching disables selectors while call actions remain usable', async () => {
    let finish
    call.selectMicrophone.mockImplementation(
        () =>
            new Promise(resolve => {
                finish = resolve
            })
    )
    const hangup = jest.fn()
    act(() =>
        root.render(
            <AnnaCallAudioControls call={call}>
                <button type="button" onClick={hangup}>
                    Hang up
                </button>
            </AnnaCallAudioControls>
        )
    )
    expect(document.querySelector('select')).toBeNull()
    openSettings()
    await select('Audio input', 'usb')
    expect([...document.querySelectorAll('select')].every(node => node.disabled)).toBe(true)
    act(() => container.querySelector('.anna-composer-actions button').click())
    expect(hangup).toHaveBeenCalledTimes(1)
    await act(async () => finish())
    expect([...document.querySelectorAll('select')].every(node => !node.disabled)).toBe(true)
    act(() => document.querySelector('button[aria-label="Close"]').click())
    const trigger = container.querySelector('button[aria-label="Audio settings"]')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)
})
