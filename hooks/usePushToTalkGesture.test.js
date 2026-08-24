/**
 * @jest-environment jsdom
 *
 * The press-and-hold gesture behind the dictation mic (AT-2405), driven with REAL DOM events.
 *
 * That is the whole point of testing it here rather than through react-native-web's press props:
 * this codebase already found the RNW responder layer undeliverable for a hold gesture (see the
 * comment on BottomSheet's drag handle) and it does not deliver in jsdom at all, so a test that
 * called `props.onPressIn()` would only be testing that a prop exists. These tests dispatch the
 * same pointer/touch/mouse events a browser does, including the mixed streams that made the
 * `activeGesture` guard necessary.
 */
import React, { useState } from 'react'
import { act } from 'react-test-renderer'
import { createRoot } from 'react-dom/client'

import usePushToTalkGesture from './usePushToTalkGesture'

let container
let root
let events

const Harness = ({ enabled = true }) => {
    const [node, setNode] = useState(null)
    usePushToTalkGesture(node, {
        enabled,
        onPressStart: () => events.push({ type: 'start' }),
        onPressEnd: release => events.push({ type: 'end', ...release }),
    })
    return <div ref={setNode} data-testid="mic" />
}

const mount = (props = {}) => {
    act(() => {
        root.render(<Harness {...props} />)
    })
    return container.querySelector('[data-testid="mic"]')
}

// jsdom has no layout, so getBoundingClientRect is all zeroes and every release would count as
// "unmeasurable". Give the node a real rect so inside/outside is actually exercised.
const giveRect = (node, rect = { left: 0, top: 0, right: 50, bottom: 50, width: 50, height: 50 }) => {
    node.getBoundingClientRect = () => rect
}

const dispatch = (target, type, init = {}) => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.assign(event, init)
    act(() => {
        target.dispatchEvent(event)
    })
    return event
}

const touch = (identifier, clientX, clientY) => ({ identifier, clientX, clientY })

beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    events = []
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

describe('usePushToTalkGesture', () => {
    test('a mouse press reports start on press-down and end on release, with how long it was held', () => {
        const node = mount()
        giveRect(node)

        dispatch(node, 'mousedown', { button: 0, clientX: 10, clientY: 10 })
        expect(events).toEqual([{ type: 'start' }])

        dispatch(window, 'mouseup', { clientX: 10, clientY: 10 })
        expect(events[1].type).toBe('end')
        expect(events[1].releasedInside).toBe(true)
        expect(events[1].cancelled).toBe(false)
        expect(typeof events[1].heldMs).toBe('number')
    })

    test('releasing away from the button reports releasedInside false — the cancel gesture', () => {
        const node = mount()
        giveRect(node)

        dispatch(node, 'mousedown', { button: 0, clientX: 10, clientY: 10 })
        dispatch(window, 'mouseup', { clientX: 400, clientY: 400 })

        expect(events[1]).toMatchObject({ type: 'end', releasedInside: false, cancelled: false })
    })

    test('the release is caught even though it happens off the button (window listener)', () => {
        const node = mount()
        giveRect(node)

        dispatch(node, 'mousedown', { button: 0, clientX: 10, clientY: 10 })
        // A node-local listener would never see this and the mic would stay hot forever.
        dispatch(document.body, 'mouseup', { clientX: 400, clientY: 400 })

        expect(events.filter(event => event.type === 'end')).toHaveLength(1)
    })

    test('press-down keeps the caret: it prevents default and does not bubble', () => {
        const node = mount()
        giveRect(node)
        const bubbled = jest.fn()
        container.addEventListener('mousedown', bubbled)

        const event = dispatch(node, 'mousedown', { button: 0, clientX: 10, clientY: 10 })

        // preventDefault is what stops the editor losing focus and its selection — the transcript
        // is inserted AT that selection. stopPropagation keeps a draggable ancestor
        // (@hello-pangea/dnd starts a drag 120ms after touchstart) from stealing the gesture.
        expect(event.defaultPrevented).toBe(true)
        expect(bubbled).not.toHaveBeenCalled()
    })

    test('a right-click is not a press', () => {
        const node = mount()
        dispatch(node, 'mousedown', { button: 2, clientX: 10, clientY: 10 })
        expect(events).toEqual([])
    })

    test('a touch press works end to end', () => {
        const node = mount()
        giveRect(node)

        dispatch(node, 'touchstart', { changedTouches: [touch(1, 10, 10)] })
        expect(events).toEqual([{ type: 'start' }])

        dispatch(window, 'touchend', { changedTouches: [touch(1, 10, 10)] })
        expect(events[1]).toMatchObject({ type: 'end', releasedInside: true })
    })

    test('touchcancel ends the take instead of leaving the microphone running', () => {
        const node = mount()
        giveRect(node)

        dispatch(node, 'touchstart', { changedTouches: [touch(1, 10, 10)] })
        dispatch(window, 'touchcancel', { changedTouches: [touch(1, 10, 10)] })

        expect(events[1]).toMatchObject({ type: 'end', cancelled: true, releasedInside: false })
    })

    test('a browser that emits BOTH pointer and touch still starts exactly one recording', () => {
        const node = mount()
        giveRect(node)

        // Real browsers send pointerdown before touchstart. Two "start" events here would mean two
        // getUserMedia calls racing for the same microphone.
        dispatch(node, 'pointerdown', { pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: 10, clientY: 10 })
        dispatch(node, 'touchstart', { changedTouches: [touch(1, 10, 10)] })

        expect(events.filter(event => event.type === 'start')).toHaveLength(1)

        // ...and the touch stream is the one that ends it, so a missing pointerup cannot strand it.
        dispatch(window, 'touchend', { changedTouches: [touch(1, 10, 10)] })
        expect(events.filter(event => event.type === 'end')).toHaveLength(1)
    })

    test('the synthetic mouse events a touch leaves behind do not start a second press', () => {
        const node = mount()
        giveRect(node)

        dispatch(node, 'touchstart', { changedTouches: [touch(1, 10, 10)] })
        dispatch(window, 'touchend', { changedTouches: [touch(1, 10, 10)] })
        dispatch(node, 'mousedown', { button: 0, clientX: 10, clientY: 10 })

        expect(events.filter(event => event.type === 'start')).toHaveLength(1)
    })

    test('losing the window mid-hold ends the take as cancelled', () => {
        const node = mount()
        giveRect(node)

        dispatch(node, 'mousedown', { button: 0, clientX: 10, clientY: 10 })
        dispatch(window, 'blur')

        expect(events[1]).toMatchObject({ type: 'end', cancelled: true })
    })

    test('a second press-down while one is active is ignored', () => {
        const node = mount()
        giveRect(node)

        dispatch(node, 'mousedown', { button: 0, clientX: 10, clientY: 10 })
        dispatch(node, 'mousedown', { button: 0, clientX: 10, clientY: 10 })

        expect(events.filter(event => event.type === 'start')).toHaveLength(1)
    })

    test('disabled installs nothing', () => {
        const node = mount({ enabled: false })
        giveRect(node)

        dispatch(node, 'mousedown', { button: 0, clientX: 10, clientY: 10 })
        dispatch(window, 'mouseup', { clientX: 10, clientY: 10 })

        expect(events).toEqual([])
    })

    test('unmounting removes the window listeners', () => {
        const node = mount()
        giveRect(node)
        dispatch(node, 'mousedown', { button: 0, clientX: 10, clientY: 10 })

        act(() => root.render(<div />))
        dispatch(window, 'mouseup', { clientX: 10, clientY: 10 })

        expect(events.filter(event => event.type === 'end')).toHaveLength(0)
    })
})
