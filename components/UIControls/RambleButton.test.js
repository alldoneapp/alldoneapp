/**
 * @jest-environment jsdom
 *
 * What dictation TELLS the user when the microphone produced nothing (AT-2357).
 *
 * This is not cosmetic. The reported failure was a message naming "MacBook Pro Microphone" to a
 * user who had selected a webcam in macOS — technically accurate, and it sent him to the one place
 * (System Settings) that could not fix it, because the browser keeps its own microphone choice. The
 * branch below is the difference between "your microphone is broken" and "we recorded from a
 * different device than you think, here is where to change it".
 */
import React from 'react'
import renderer, { act } from 'react-test-renderer'

import { useRambleController } from './RambleButton'

let recorderOptions
jest.mock('../../hooks/useRambleRecorder', () => ({
    __esModule: true,
    default: jest.fn(options => {
        recorderOptions = options
        return { isRecording: false, elapsedSeconds: 0, start: jest.fn(), stop: jest.fn(), cancel: jest.fn() }
    }),
}))
jest.mock('../../hooks/useEscapeKey', () => jest.fn())
jest.mock('../Icon', () => 'Icon')
jest.mock('../../i18n/TranslationService', () => ({
    // Keep the key AND the interpolation so a test can assert both the branch and the device name.
    translate: jest.fn((key, params) => (params ? `${key} :: ${JSON.stringify(params)}` : key)),
}))
jest.mock('../../utils/backends/Rambler/ramblerBackend', () => ({ processRamble: jest.fn() }))
jest.mock('../../redux/store', () => ({ getState: () => ({ loggedUser: {} }), dispatch: jest.fn() }))
jest.mock('../../redux/actions', () => ({ setShowLimitedFeatureModal: jest.fn() }))

const Harness = () => {
    useRambleController({ projectId: 'p1', onTextReady: jest.fn(), getCurrentText: () => '' })
    return null
}

let alertSpy

beforeEach(() => {
    alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {})
    act(() => {
        renderer.create(<Harness />)
    })
})

afterEach(() => {
    alertSpy.mockRestore()
})

const reportError = (code, details) =>
    act(() => {
        recorderOptions.onError(code, details)
    })

describe('rambler error messages', () => {
    test("a silent take names the device as the BROWSER's choice, not the system input", () => {
        reportError('silent-input', { deviceLabel: 'MacBook Pro Microphone', triedDeviceLabels: [] })

        const message = alertSpy.mock.calls[0][0]
        expect(message).toContain('No sound came from the browser microphone')
        expect(message).toContain('MacBook Pro Microphone')
    })

    test('when other microphones were tried too, the message says which ones', () => {
        reportError('silent-input', {
            deviceLabel: 'MacBook Pro Microphone',
            triedDeviceLabels: ['MacBook Pro Microphone', 'HD Webcam'],
        })

        const message = alertSpy.mock.calls[0][0]
        expect(message).toContain('No sound came from any microphone')
        // The device we recorded from is not repeated in the "also tried" list.
        expect(message).toContain('"devices":"HD Webcam"')
    })

    test('without a device label it falls back to the generic advice', () => {
        reportError('silent-input', {})

        expect(alertSpy).toHaveBeenCalledWith('No sound came from your microphone. Check your system input device.')
    })

    test('the automatic mid-flight switch still asks for one retry', () => {
        reportError('silent-input-retry', { deviceLabel: 'MacBook Pro Microphone' })

        expect(alertSpy).toHaveBeenCalledWith(
            'No sound came from your microphone. Switched recording mode, please try again.'
        )
    })

    test('a server-side empty transcript names the microphone that was listened to', async () => {
        const { processRamble } = require('../../utils/backends/Rambler/ramblerBackend')
        processRamble.mockRejectedValueOnce(new Error('EMPTY_TRANSCRIPT'))

        await act(async () => {
            await recorderOptions.onComplete({
                audioBase64: 'data:audio/webm;base64,AA',
                mimeType: 'audio/webm',
                durationSeconds: 3,
                deviceLabel: 'MacBook Pro Microphone',
            })
        })

        const message = alertSpy.mock.calls[0][0]
        expect(message).toContain('No speech detected on the microphone')
        expect(message).toContain('MacBook Pro Microphone')
    })

    test('an unsupported browser stays silent instead of alerting', () => {
        reportError('not-supported')

        expect(alertSpy).not.toHaveBeenCalled()
    })
})
