import React, { useLayoutEffect, useRef, useState } from 'react'
import { getWorkspaceViewport, WORKSPACE_VIEWPORT_EVENT } from './workspaceViewport'

// App content and popup sizes follow the Alldone pane in assistant mode.
// Shell-level layout decisions must use the physical browser/media query.

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
    const { width, height } = getWorkspaceViewport()
    return [width, height]
}

export default function useWindowSize() {
    const [size, setSize] = useState(getInitialWindowSize)
    const sizeRef = useRef(size)
    useLayoutEffect(() => {
        const updateSize = event => {
            const { width, height } = getWorkspaceViewport()
            const currentSize = sizeRef.current
            // Position-only changes also move portals and change safe-area
            // overlap, even when the available width/height stay the same.
            if (currentSize[0] === width && currentSize[1] === height && event?.type !== WORKSPACE_VIEWPORT_EVENT)
                return

            const nextSize = [width, height]
            sizeRef.current = nextSize
            setSize(nextSize)
        }
        window.addEventListener('resize', updateSize)
        window.addEventListener(WORKSPACE_VIEWPORT_EVENT, updateSize)
        updateSize()

        return () => {
            window.removeEventListener('resize', updateSize)
            window.removeEventListener(WORKSPACE_VIEWPORT_EVENT, updateSize)
        }
    }, [])

    return size
}

export function withWindowSizeHook(Component) {
    return function WrappedComponent(props) {
        const windowSize = useWindowSize()
        return <Component {...props} windowSize={windowSize} />
    }
}
