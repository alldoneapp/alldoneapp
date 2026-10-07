import { useLayoutEffect, useState } from 'react'
import { getWorkspaceViewport, setWorkspaceViewport, WORKSPACE_VIEWPORT_EVENT } from '../utils/workspaceViewport'

export default function useWorkspaceViewport() {
    const [viewport, setViewport] = useState(getWorkspaceViewport)
    useLayoutEffect(() => {
        const update = () => setViewport(getWorkspaceViewport())
        window.addEventListener('resize', update)
        window.addEventListener(WORKSPACE_VIEWPORT_EVENT, update)
        update()
        return () => {
            window.removeEventListener('resize', update)
            window.removeEventListener(WORKSPACE_VIEWPORT_EVENT, update)
        }
    }, [])
    return viewport
}

export function useWorkspaceViewportOwner(ref, active) {
    useLayoutEffect(() => {
        if (!active || !ref.current) return
        const update = () => setWorkspaceViewport(ref.current?.getBoundingClientRect())
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
        observer?.observe(ref.current)
        window.addEventListener('resize', update)
        // Scroll can move the origin without changing the element's size.
        window.addEventListener('scroll', update, true)
        update()
        return () => {
            observer?.disconnect()
            window.removeEventListener('resize', update)
            window.removeEventListener('scroll', update, true)
            setWorkspaceViewport(null)
        }
    }, [active, ref])
}
