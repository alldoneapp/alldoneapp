import { useEffect, useRef, useState } from 'react'

import { measureKeyboardInset, isKeyboardInsetOpen } from '../utils/virtualKeyboard'
import { getSafeAreaInsets } from '../utils/safeAreaInsets'

const MARGIN_PX = 12

// Popover portals are position: fixed, so the shell's keyboard shrink
// (AT-2248) cannot move them, and the vendored react-tiny-popover nudge only
// knows the full viewport — the mobile keyboard simply covers whatever part of
// a popup falls behind it (seen first on the iPad add-task popup, AT-2220
// follow-up). This measures the referenced element whenever the visual
// viewport changes and returns how many px to lift it (apply as
// translateY(-lift)) so its bottom clears the keyboard, clamped so its top
// never enters the top safe area. 0 whenever no keyboard is open, so desktop
// and closed-keyboard states are untouched.
export default function useLiftAboveKeyboard(elementRef) {
    const [lift, setLift] = useState(0)
    const liftRef = useRef(0)

    useEffect(() => {
        if (typeof window === 'undefined') return undefined

        const update = () => {
            const node = elementRef.current
            if (!node || typeof node.getBoundingClientRect !== 'function') return
            const inset = measureKeyboardInset()
            if (!isKeyboardInsetOpen(inset)) {
                liftRef.current = 0
                setLift(0)
                return
            }
            // Measure the PARENT (the popover container): it lays the card
            // out and is unaffected by the card's own translateY, so it is a
            // feedback-free base position. Measuring the card itself is a
            // trap — its rect includes the previously applied lift and is
            // stale mid-transition, which compounds the error on every
            // keyboard-animation viewport event.
            const base = (node.parentElement || node).getBoundingClientRect()
            const visibleBottom = window.innerHeight - inset - MARGIN_PX
            const needed = Math.max(0, base.bottom - visibleBottom)
            const maxLift = Math.max(0, base.top - (getSafeAreaInsets().top + MARGIN_PX))
            const next = Math.round(Math.min(needed, maxLift))
            liftRef.current = next
            setLift(next)
        }

        // Run once on mount (the keyboard may already be open when the popup
        // opens) and again whenever the visual viewport changes (the keyboard
        // arriving, leaving, or resizing — e.g. iPad orientation changes).
        update()
        const viewport = window.visualViewport
        if (viewport) viewport.addEventListener('resize', update)
        window.addEventListener('resize', update)
        return () => {
            if (viewport) viewport.removeEventListener('resize', update)
            window.removeEventListener('resize', update)
        }
    }, [])

    return lift
}
