import { useEffect, useState } from 'react'

import { getSafeAreaBottomInset } from '../utils/safeAreaInsets'
import { KEYBOARD_OPEN_CLASS } from '../utils/virtualKeyboard'

// Since the shell templates stopped reserving the home-indicator region on
// #root, bottom-anchored interactive surfaces lift themselves above the
// indicator instead. Returns the bottom safe-area inset in px — and 0 while
// the virtual keyboard is open, because the measured keyboard inset (AT-2248,
// which shrinks the whole shell) already includes the covered indicator
// strip; keeping the lift then would float the surface ~34px above the
// keyboard. Resolves to 0 on every surface without a home indicator
// (desktop, Android, browser tabs), so callers can apply it unconditionally.
const readLift = () => {
    if (typeof document === 'undefined') return 0
    if (document.documentElement.classList.contains(KEYBOARD_OPEN_CLASS)) return 0
    return getSafeAreaBottomInset()
}

export default function useHomeIndicatorLift() {
    const [lift, setLift] = useState(readLift)

    useEffect(() => {
        const update = () => setLift(readLift())
        // Rotation / resize changes the inset; the keyboard toggles the class
        // on <html> (watched via MutationObserver — there is no event for it).
        window.addEventListener('resize', update)
        const observer = new MutationObserver(update)
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
        update()
        return () => {
            window.removeEventListener('resize', update)
            observer.disconnect()
        }
    }, [])

    return lift
}
