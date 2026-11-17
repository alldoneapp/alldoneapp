import { useEffect, useState } from 'react'

import { isKeyboardVisible } from '../utils/virtualKeyboard'

/**
 * AT-3076 — whether a software keyboard is currently up, on either detection path
 * of `utils/virtualKeyboard.js` (iOS inset or Android layout-viewport resize).
 * Always false on desktop and without `visualViewport`.
 *
 * The keyboard toggles a class on <html>; there is no event for it, so the class
 * is watched with a MutationObserver (same pattern as `useHomeIndicatorLift`).
 */
export default function useVirtualKeyboardVisible() {
    const [visible, setVisible] = useState(isKeyboardVisible)

    useEffect(() => {
        if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return undefined

        const update = () => setVisible(isKeyboardVisible())
        const observer = new MutationObserver(update)
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
        update()
        return () => observer.disconnect()
    }, [])

    return visible
}
