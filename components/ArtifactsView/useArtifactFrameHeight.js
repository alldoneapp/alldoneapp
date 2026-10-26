import { useEffect, useState } from 'react'

import { readFrameHeightMessage } from '../../functions/Artifacts/artifactFrameHeight'

// A sandboxed frame without allow-same-origin runs in an opaque origin, which posts as 'null'.
// Every artifact page the app frames is sandboxed, so a message from anywhere else is not one.
const OPAQUE_ORIGIN = 'null'

// The natural height of a framed HTML artifact (AT-2881), as the page reports it
// (functions/Artifacts/artifactFrameHeight.js). The frame is cross-origin and sandboxed, so the
// app cannot measure it itself. Only messages from this frame's own window count — another
// artifact, another frame or the app itself cannot resize it — and the height is clamped.
//
// null until the page has reported, and for good if it never does (a cached response from before
// the reporter, a page whose own CSP blocks inline script): the caller keeps its fixed height then.
// The state belongs to one frame showing one address; the component using this is keyed by it.
export default function useArtifactFrameHeight({ frameRef, enabled }) {
    const [height, setHeight] = useState(null)

    useEffect(() => {
        if (!enabled || typeof window === 'undefined') return undefined
        const onMessage = event => {
            const frameWindow = frameRef.current?.contentWindow
            if (!frameWindow || event.source !== frameWindow || event.origin !== OPAQUE_ORIGIN) return
            const next = readFrameHeightMessage(event.data)
            if (next === null) return
            setHeight(current => (current !== null && Math.abs(current - next) < 2 ? current : next))
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
    }, [enabled, frameRef])

    return enabled ? height : null
}
