import { useEffect, useRef } from 'react'

import { pushEscapeHandler } from '../utils/escapeStack'

/**
 * Close this popup when the user presses Escape (AT-2257).
 *
 * Use this instead of `document.addEventListener('keydown', ...)`: a bubble-phase
 * document listener never sees Escape while a react-native-web TextInput has
 * focus, which is the normal state of a popup that autofocuses its field. See
 * `utils/escapeStack.js` for the whole story.
 *
 * Registration is LIFO, so nesting works without any coordination between the
 * layers: a picker opened from inside a modal mounts later, gets Escape first,
 * closes itself, and the modal around it stays open.
 *
 * @param {(event: KeyboardEvent) => void} onEscape
 * @param {{ enabled?: boolean }} [options] `enabled: false` makes this layer
 *        inert without giving up its place in the stack.
 */
export default function useEscapeKey(onEscape, options = {}) {
    const { enabled = true } = options

    // Read through refs so the registration below can run exactly once per
    // mount. Re-registering on every render would push this layer back to the
    // top of the stack on each re-render — and every one of these modals
    // re-renders constantly — so a modal would out-rank the picker it opened.
    const onEscapeRef = useRef(onEscape)
    onEscapeRef.current = onEscape

    const enabledRef = useRef(enabled)
    enabledRef.current = enabled

    useEffect(() => {
        return pushEscapeHandler(
            event => {
                onEscapeRef.current(event)
            },
            { isEnabled: () => enabledRef.current }
        )
    }, [])
}
