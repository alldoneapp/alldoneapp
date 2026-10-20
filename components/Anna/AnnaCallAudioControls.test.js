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
const tick = () => act(() => jest.advanceTimersByTime(100))
const select = async (label, value) =>
    act(async () => {
        const node = container.querySelector(`[aria-label="${label}"]`)
        node.value = value
        node.dispatchEvent(new Event('change', { bubbles: true }))
    })

test('independent live meters fall to silence and stay zero when muted or unavailable without rerendering the parent', () => {
    const parent = jest.fn(() => <AnnaCallAudioControls call={call} />)
    act(() => root.render(React.createElement(parent)))
    const values = () =>
        [...container.querySelectorAll('[role="progressbar"]')].map(node => node.getAttribute('aria-valuenow'))
    expect(values()).toEqual(['50', '80'])
    input.level = 0
    output.level = 0.09
    tick()
    expect(values()).toEqual(['0', '30'])
    input = { ...input, level: 1, muted: true }
    output = { ...output, level: 1, available: false }
    tick()
    expect(values()).toEqual(['0', '0'])
    expect(parent).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Audio level unavailable')
})

test('switches input and output without submitting the containing form and reflects confirmed selections', async () => {
    render()
    await select('Audio input', 'usb')
    tick()
    expect(call.selectMicrophone).toHaveBeenCalledWith('usb')
    expect(container.querySelector('[aria-label="Audio input"]').value).toBe('usb')
    await select('Audio output', 'headphones')
    tick()
    expect(call.selectAudioOutput).toHaveBeenCalledWith('headphones')
    expect(container.querySelector('[aria-label="Audio output"]').value).toBe('headphones')
    await select('Audio output', 'choose')
    expect(call.selectAudioOutput).toHaveBeenLastCalledWith('choose')
})

test('shows a failed switch without changing the confirmed device or blocking hangup elsewhere', async () => {
    call.selectMicrophone.mockRejectedValue(new Error('Device busy'))
    render()
    await select('Audio input', 'usb')
    expect(container.querySelector('[role="alert"]').textContent).toBe('Could not change microphone')
    expect(container.querySelector('[aria-label="Audio input"]').value).toBe('')
    expect(container.querySelector('[aria-label="Audio input"]').disabled).toBe(false)
})

test('platforms without selection retain both meters and explain system routing; ending disables selectors', () => {
    devices.supportsInputSelection = devices.supportsOutputSelection = false
    render()
    expect(container.querySelector('select')).toBeNull()
    expect(container.textContent).toContain('Choose audio devices in your browser or system settings')
    expect(container.querySelectorAll('[role="progressbar"]')).toHaveLength(2)
    devices.supportsInputSelection = devices.supportsOutputSelection = true
    call.status = 'ending'
    render()
    tick()
    expect([...container.querySelectorAll('select')].every(node => node.disabled)).toBe(true)
})

test('updates device options after hotplug and stops polling when the call controls unmount', () => {
    const read = jest.spyOn(call, 'getMicrophoneSnapshot')
    render()
    devices.inputDevices.push({ deviceId: 'new', label: 'New microphone' })
    tick()
    expect(container.textContent).toContain('New microphone')
    act(() => root.unmount())
    const reads = read.mock.calls.length
    tick()
    expect(read).toHaveBeenCalledTimes(reads)
})
