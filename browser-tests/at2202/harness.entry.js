/**
 * AT-2202 browser regression harness — entry point.
 *
 * The defect is purely geometric: while the assistant composer's text field is
 * expanded, the voice-call button and the send button must sit directly below
 * each other, and the field must expand into the width the row layout no longer
 * needs. jsdom (which the Jest suites run on) implements no layout at all —
 * every box is 0x0 — so a unit test can only assert on style objects. It cannot
 * see that `Button`'s own `buttonMaster.alignSelf: 'flex-start'` overrides the
 * cluster's `alignItems: 'center'`, which is exactly the override that pulled
 * the send button off the shared centre axis in production.
 *
 * This harness therefore renders the REAL `AssistantInputLine` (the same
 * stacking helper, cluster styles and control components that
 * `AssistantOptions` uses) against the real Redux store in real Chromium, and
 * `run.js` asserts on `getBoundingClientRect()` — i.e. on what the user sees.
 *
 * Expansion is driven by real typing: react-native-web's multiline TextInput
 * reports `onContentSizeChange` from the textarea's own `scrollHeight`, so the
 * browser's real line wrapping — the thing that used to feed back into the
 * cluster width and make the field wiggle — is in the loop here.
 */
import 'setimmediate'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'

import store from '../../redux/store'
import { toggleSmallScreenNavigation } from '../../redux/actions'
import AssistantInputLine from '../../components/TaskListView/OpenTasksView/OpenTaskViewForAssistants/AssistantInputLine'

const PROJECT_ID = 'proj-1'

const assistant = {
    uid: 'assistant-1',
    displayName: 'Anna',
    photoURL300: '',
    isAssistant: true,
}

const params = new URLSearchParams(window.location.search)
// The composer is `flex: 1` inside the app shell, so the harness pins an outer
// width instead of relying on the (headless) window size.
const containerWidth = Number(params.get('width') || 720)
const smallScreen = params.get('mobile') === '1'

try {
    store.dispatch(toggleSmallScreenNavigation(smallScreen))
} catch (error) {
    // Older action signature / store shape — the default (desktop) still runs.
    console.warn('could not set smallScreenNavigation', error && error.message)
}

function Harness() {
    return (
        <div style={{ width: containerWidth, padding: 0, margin: 0 }}>
            <AssistantInputLine assistant={assistant} projectId={PROJECT_ID} />
        </div>
    )
}

const container = document.getElementById('root')
createRoot(container).render(
    <Provider store={store}>
        <Harness />
    </Provider>
)

const rect = element => {
    if (!element) return null
    const { x, y, width, height } = element.getBoundingClientRect()
    return { x, y, width, height, centerX: x + width / 2, top: y, bottom: y + height, right: x + width }
}

// Measure the two controls and the field the way the user perceives them.
//
// Deliberately located by their accessibility labels rather than by a testID
// the fix happens to add: the harness must be able to run against the ORIGINAL
// code too, otherwise it proves nothing about whether it can catch the defect.
window.__measure = () => {
    const call = document.querySelector('[aria-label="Start voice call"]')
    const send = document.querySelector('[aria-label="Send"]')
    const textarea = document.querySelector('textarea')
    if (!call || !send || !textarea) return null

    // The cluster is the nearest common ancestor of the two controls.
    const ancestors = new Set()
    for (let node = call; node; node = node.parentElement) ancestors.add(node)
    let cluster = send
    while (cluster && !ancestors.has(cluster)) cluster = cluster.parentElement

    return { cluster: rect(cluster), call: rect(call), send: rect(send), input: rect(textarea) }
}

window.__setText = text => {
    const textarea = document.querySelector('textarea')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

// Report a content height the way react-native-web's multiline TextInput does
// (it reads the textarea's own scrollHeight and calls onContentSizeChange).
//
// Headless Chromium paints no glyphs for this build — neither the value nor the
// placeholder — so its scrollHeight always reports a single line and cannot
// drive the expansion. Calling the component's REAL onContentSizeChange prop
// with the height a wrapped line would produce keeps everything that this test
// is actually about — the component's own state machine, the flex row, the
// cluster's row/column switch, Button's alignSelf, the resulting widths — real
// and measured by the real layout engine.
window.__reportContentHeight = height => {
    const textarea = document.querySelector('textarea')
    // react-native-web consumes onContentSizeChange internally, so it is not on
    // the DOM node's props — walk the fiber tree up to the TextInput element
    // that owns it, which is the component the app actually rendered.
    const fiberKey = Object.keys(textarea).find(key => key.startsWith('__reactFiber$'))
    let fiber = textarea[fiberKey]
    let handler = null
    while (fiber && !handler) {
        if (fiber.memoizedProps && typeof fiber.memoizedProps.onContentSizeChange === 'function') {
            handler = fiber.memoizedProps.onContentSizeChange
        }
        fiber = fiber.return
    }
    if (!handler) throw new Error('no onContentSizeChange found above the textarea')
    handler({ nativeEvent: { contentSize: { height, width: textarea.clientWidth } } })
}

window.__ready = true
