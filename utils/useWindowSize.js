import React, { useLayoutEffect, useState } from 'react'

// Starting at [0, 0] made every consumer render one frame with a bogus size.
// That is invisible for most of them, but modals cap themselves with
// `maxHeight: getSafeAreaModalMaxHeight(windowSize[1])`, which resolves to a
// negative (ignored) max-height on that first frame — so the modal is laid out
// at its full natural height. react-tiny-popover measures the popover exactly
// then, and a contentLocation helper centers against that unclamped height,
// which lands the popover off-screen on short mobile viewports (AT-2189).
// Seeding with the real viewport keeps the first measured layout the correct
// one. Consumers that already guarded with `windowSize?.[1] || <fallback>` are
// unaffected.
const getInitialWindowSize = () => {
    if (typeof window === 'undefined') return [0, 0]
    return [window.innerWidth || 0, window.innerHeight || 0]
}

export default function useWindowSize() {
    const [size, setSize] = useState(getInitialWindowSize)
    useLayoutEffect(() => {
        const updateSize = () => {
            setSize([window.innerWidth, window.innerHeight])
        }
        window.addEventListener('resize', updateSize)
        updateSize()

        return () => window.removeEventListener('resize', updateSize)
    }, [])

    return size
}

export function withWindowSizeHook(Component) {
    return function WrappedComponent(props) {
        const windowSize = useWindowSize()
        return <Component {...props} windowSize={windowSize} />
    }
}
