/**
 * @jest-environment jsdom
 *
 * Holding the real mic button, with real DOM events, all the way to the overlay (AT-2408).
 *
 * The two suites next door prove the pieces: `pushToTalk.test.js` proves the rule, and
 * `RambleHoldOverlay.test.js` proves the drawing. Neither proves they are connected, and this
 * feature is almost entirely connection — a press has to reach the overlay through the gesture, a
 * pointer move has to reach the cancel state, and the release has to be judged by the same distance
 * the ring was drawn at. Every one of those seams is invisible to a test of either half, and the
 * original AT-2405 suite already learned this lesson the hard way (see its "the mic button is
 * actually wired to the gesture" block).
 *
 * The recorder is a double — the microphone is not what is under test — but the button, the
 * gesture, the overlay and the decision logic are all real.
 */
import React from 'react'
import { act } from 'react-test-renderer'
import { createRoot } from 'react-dom/client'

import { PUSH_TO_TALK_CANCEL_RADIUS, PUSH_TO_TALK_MIN_RECORDING_MS } from './pushToTalk'
import { RAMBLE_HOLD_OVERLAY_DELAY_MS } from './RambleButton'

let mockRecording
const mockStart = jest.fn(() => {
    mockRecording = true
})
const mockStop = jest.fn(() => true)
const mockCancel = jest.fn()
const mockGetInputLevel = jest.fn(() => 0.2)

jest.mock('../../hooks/useRambleRecorder', () => ({
    __esModule: true,
    default: jest.fn(() => ({
        isRecording: mockRecording,
        elapsedSeconds: 7,
        start: mockStart,
        stop: mockStop,
        cancel: mockCancel,
        getInputLevel: mockGetInputLevel,
    })),
}))
jest.mock('../../hooks/useEscapeKey', () => jest.fn())
jest.mock('../Icon', () => {
    const React = require('react')
    return function IconStub({ name }) {
        return React.createElement('span', { 'data-testid': `icon-${name}` })
    }
})
jest.mock('../../i18n/TranslationService', () => ({ translate: jest.fn(key => key) }))
jest.mock('../../utils/backends/Rambler/ramblerBackend', () => ({ processRamble: jest.fn() }))
jest.mock('../../redux/store', () => ({ getState: () => ({ loggedUser: {} }), dispatch: jest.fn() }))
jest.mock('../../redux/actions', () => ({ setShowLimitedFeatureModal: jest.fn() }))
jest.mock('../UIComponents/Ghosts/ghostAnimation', () => ({ useReducedMotion: () => false }))

const RambleButton = require('./RambleButton').default

let container
let root
let vibrateSpy

const PRESS = { clientX: 300, clientY: 600 }

const dispatch = (target, type, init = {}) => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.assign(event, init)
    act(() => {
        target.dispatchEvent(event)
    })
    return event
}

const mic = () => container.querySelector('[aria-label="Dictate"]') || container.firstElementChild

const overlay = () => document.body.querySelector('[data-testid="ramble-hold-overlay"]')
const card = () => document.body.querySelector('[data-testid="ramble-hold-card"]')

// The overlay is deliberately delayed so a tap does not flash a ring across the screen.
const settleHoldDelay = () => {
    act(() => {
        jest.advanceTimersByTime(RAMBLE_HOLD_OVERLAY_DELAY_MS + 10)
    })
}

const pressAndHold = (point = PRESS) => {
    dispatch(mic(), 'mousedown', { button: 0, ...point })
    mockRecording = true
    settleHoldDelay()
}

const slideTo = (clientX, clientY) => dispatch(window, 'mousemove', { clientX, clientY })
const releaseAt = (clientX, clientY) => dispatch(window, 'mouseup', { clientX, clientY })

beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    global.IS_REACT_ACT_ENVIRONMENT = true
    mockRecording = false
    vibrateSpy = jest.fn(() => true)
    navigator.vibrate = vibrateSpy
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
        root.render(<RambleButton projectId="p1" onTextReady={jest.fn()} onSubmit={jest.fn()} />)
    })
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
    jest.useRealTimers()
})

describe('holding the mic shows the recording state where the thumb is not', () => {
    test('a hold raises the overlay, and its ring is centred on the finger', () => {
        expect(overlay()).toBeFalsy()

        pressAndHold({ clientX: 300, clientY: 600 })

        expect(overlay()).toBeTruthy()
        const ring = document.body.querySelector('[data-testid="ramble-hold-ring-safe"]')
        expect(ring.style.left).toBe(`${300 - PUSH_TO_TALK_CANCEL_RADIUS}px`)
        expect(ring.style.top).toBe(`${600 - PUSH_TO_TALK_CANCEL_RADIUS}px`)
    })

    test('a quick tap never flashes the overlay', () => {
        // A tap is 80-150ms and comes through the exact same handler as a hold, so without the
        // delay every tap-to-dictate would strobe a 192px circle over the screen.
        dispatch(mic(), 'mousedown', { button: 0, ...PRESS })
        mockRecording = true
        act(() => {
            jest.advanceTimersByTime(100)
        })
        releaseAt(PRESS.clientX, PRESS.clientY)
        settleHoldDelay()

        expect(overlay()).toBeFalsy()
    })

    test('the overlay is gone the moment the finger lifts', () => {
        pressAndHold()
        expect(overlay()).toBeTruthy()

        releaseAt(PRESS.clientX, PRESS.clientY)

        expect(overlay()).toBeFalsy()
    })

    test('it carries the elapsed time and the way out', () => {
        pressAndHold()

        expect(card().textContent).toContain('0:07')
        expect(card().textContent).toContain('Slide away to cancel')
    })
})

describe('sliding towards cancel is visible before it happens', () => {
    test('crossing the ring flips the overlay into the cancel state', () => {
        pressAndHold()
        expect(card().textContent).toContain('Slide away to cancel')

        slideTo(PRESS.clientX, PRESS.clientY - PUSH_TO_TALK_CANCEL_RADIUS - 10)

        expect(card().textContent).toContain('Release to cancel')
        expect(card().querySelector('[data-testid="icon-trash-2"]')).toBeTruthy()
    })

    test('sliding back inside the ring takes the cancel state away again', () => {
        pressAndHold()
        slideTo(PRESS.clientX, PRESS.clientY - PUSH_TO_TALK_CANCEL_RADIUS - 10)
        expect(card().textContent).toContain('Release to cancel')

        slideTo(PRESS.clientX, PRESS.clientY - 20)

        // Nothing is committed until the finger lifts, so the user must be able to change their
        // mind and see that they have.
        expect(card().textContent).toContain('Slide away to cancel')
    })

    test('drifting inside the ring changes nothing', () => {
        pressAndHold()

        slideTo(PRESS.clientX + 30, PRESS.clientY + 20)

        expect(card().textContent).toContain('Slide away to cancel')
    })

    test('the boundary buzzes on the way out and on the way back', () => {
        pressAndHold()

        slideTo(PRESS.clientX, PRESS.clientY - PUSH_TO_TALK_CANCEL_RADIUS - 10)
        expect(vibrateSpy).toHaveBeenCalledTimes(1)

        // Still outside: crossing is an EDGE, not a state that re-fires on every move event, or the
        // phone would buzz continuously while the thumb sits outside the ring.
        slideTo(PRESS.clientX, PRESS.clientY - PUSH_TO_TALK_CANCEL_RADIUS - 40)
        expect(vibrateSpy).toHaveBeenCalledTimes(1)

        slideTo(PRESS.clientX, PRESS.clientY - 10)
        expect(vibrateSpy).toHaveBeenCalledTimes(2)
    })

    test('a browser without vibration support is not a crash', () => {
        delete navigator.vibrate
        pressAndHold()

        expect(() => slideTo(PRESS.clientX, PRESS.clientY - 200)).not.toThrow()
        expect(card().textContent).toContain('Release to cancel')
    })
})

describe('the release does what the ring promised', () => {
    test('released outside the ring, the take is thrown away', () => {
        pressAndHold()
        act(() => {
            jest.advanceTimersByTime(1200)
        })
        slideTo(PRESS.clientX, PRESS.clientY - 200)
        releaseAt(PRESS.clientX, PRESS.clientY - 200)

        expect(mockCancel).toHaveBeenCalled()
        expect(mockStop).not.toHaveBeenCalled()
    })

    test('released off the button but INSIDE the ring, the take is still sent', () => {
        // This is the bug in one test. The mic is 24px wide; 40px of thumb travel used to be
        // indistinguishable from a deliberate cancel, and silently binned a spoken sentence.
        pressAndHold()
        act(() => {
            jest.advanceTimersByTime(1200)
        })
        slideTo(PRESS.clientX + 40, PRESS.clientY)
        releaseAt(PRESS.clientX + 40, PRESS.clientY)

        expect(mockStop).toHaveBeenCalledWith({ minDurationMs: PUSH_TO_TALK_MIN_RECORDING_MS })
        expect(mockCancel).not.toHaveBeenCalled()
    })
})

describe('the overlay is only drawn for a press that owns the recording', () => {
    test('a press landing on a tap-started recording gets no ring', () => {
        // For that press, sliding away does NOT cancel (it is the toggle's second tap), so a ring
        // promising otherwise would be a lie the release then breaks.
        mockRecording = true
        act(() => {
            root.render(<RambleButton projectId="p1" onTextReady={jest.fn()} onSubmit={jest.fn()} />)
        })

        dispatch(mic() || container.firstElementChild, 'mousedown', { button: 0, ...PRESS })
        settleHoldDelay()

        expect(overlay()).toBeFalsy()
        expect(mockStart).not.toHaveBeenCalled()
    })
})
