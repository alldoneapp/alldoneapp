import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getDb } from '../../utils/backends/firestore'
import { translate } from '../../i18n/TranslationService'
import { subscribePageVisible, subscribePageHidden } from '../../utils/appResume'
import {
    findWorkspaceObject,
    scrollWorkspaceContainer,
    scrollWorkspaceObject,
    workspaceObjectRect,
} from './annaWorkspaceRevealTargets'

// A short, serialized visual receipt for confirmed assistant mutations. Exact object
// identities come from the mutation result, never from matching arbitrary page text.
export default function AnnaWorkspaceReveal({
    rootRef,
    conversation,
    available,
    onOpen,
    onComplete,
    workState,
    assistantName,
}) {
    const [shown, setShown] = useState(null)
    const latest = useRef(conversation)
    latest.current = conversation
    const latestWork = useRef(workState)
    latestWork.current = workState
    const seen = useRef(new Set())
    const wake = useRef(null)
    const docPath = conversation && `chatObjects/${conversation.projectId}/chats/${conversation.id}`
    const queueKey = (conversation?.annaWorkspaceChanges || []).map(change => change.id).join(',')

    useEffect(() => {
        if (!available || !docPath) return
        let cancelled = false
        let running = false
        let current = null
        let scrolling = []
        let interruptCurrent = false
        let displayed = []
        const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
        const stopped = () => cancelled || document.hidden
        const interrupted = () => stopped() || interruptCurrent
        const stopScrolling = () => {
            scrolling.forEach(node => scrollWorkspaceContainer(node, node.scrollTop, true))
            scrolling = []
        }
        const acknowledge = (change, status) => {
            getDb()
                .doc(docPath)
                .update({ [`annaWorkspaceChangeStatus.${change.id}`]: { status, at: Date.now() } })
                .catch(() => {})
        }
        const run = async () => {
            if (running || stopped()) return
            running = true
            try {
                while (!stopped()) {
                    const change = (latest.current?.annaWorkspaceChanges || []).find(
                        item =>
                            /^[a-zA-Z0-9_-]+$/.test(item.id || '') &&
                            !seen.current.has(item.id) &&
                            !latest.current?.annaWorkspaceChangeStatus?.[item.id] &&
                            item.expiresAt > Date.now()
                    )
                    if (!change) {
                        const work = latestWork.current
                        if (
                            displayed.length &&
                            !work?.busy &&
                            displayed.every(
                                item =>
                                    item.triggerMessageId && work?.completedRequests?.includes(item.triggerMessageId)
                            )
                        ) {
                            displayed = []
                            try {
                                await onComplete?.()
                            } catch (_) {
                                // Navigation is best effort; never repeat a saved mutation.
                            }
                        }
                        break
                    }
                    current = change
                    interruptCurrent = false
                    seen.current.add(change.id)
                    if (seen.current.size > 100) seen.current.delete(seen.current.values().next().value)
                    try {
                        await onOpen(change, interrupted)
                        const deadline = Date.now() + 7000
                        let target
                        // Navigation, Firestore and virtualized lists may render on different frames.
                        while (!interrupted() && Date.now() < deadline) {
                            target = findWorkspaceObject(rootRef.current, change)
                            if (target) break
                            await delay(100)
                        }
                        if (interrupted()) continue
                        if (!target) {
                            acknowledge(change, 'target_not_visible')
                            continue
                        }
                        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false
                        scrolling = scrollWorkspaceObject(target, rootRef.current, reducedMotion)
                        // Let native smooth scrolling settle before the pulse starts.
                        if (scrolling.length && !reducedMotion) {
                            let stable = 0,
                                last = '',
                                elapsed = 0
                            while (!interrupted() && elapsed < 1200 && stable < 4) {
                                await delay(50)
                                elapsed += 50
                                const position = scrolling.map(node => node.scrollTop).join(',')
                                stable = position === last ? stable + 1 : 0
                                last = position
                            }
                        }
                        if (interrupted()) {
                            stopScrolling()
                            continue
                        }
                        scrolling = []
                        let rect = workspaceObjectRect(target, rootRef.current)
                        if (!rect) {
                            acknowledge(change, 'target_not_visible')
                            continue
                        }
                        setShown({ change, rect })
                        acknowledge(change, 'shown')
                        const end = Date.now() + 3600
                        while (!interrupted() && Date.now() < end) {
                            await delay(50)
                            const next = workspaceObjectRect(target, rootRef.current)
                            if (!next) break
                            if (JSON.stringify(next) !== JSON.stringify(rect)) {
                                rect = next
                                if (!interrupted()) setShown({ change, rect })
                            }
                        }
                        if (!interrupted()) displayed.push(change)
                    } catch (_) {
                        if (!stopped()) acknowledge(change, 'unavailable')
                    } finally {
                        if (interrupted() && !cancelled) acknowledge(change, 'dismissed')
                        if (interrupted()) displayed = []
                        if (!cancelled) setShown(null)
                        current = null
                    }
                    await delay(160)
                }
            } finally {
                running = false
            }
        }
        wake.current = run
        const stopVisible = subscribePageVisible(run)
        const stopHidden = subscribePageHidden(() => {
            interruptCurrent = true
            displayed = []
            stopScrolling()
            setShown(null)
        })
        run()
        return () => {
            cancelled = true
            wake.current = null
            stopVisible()
            stopHidden()
            stopScrolling()
            if (current) acknowledge(current, 'dismissed')
            setShown(null)
        }
    }, [available, docPath, onOpen, onComplete])
    useEffect(() => {
        wake.current?.()
    }, [queueKey, workState])

    if (!shown || !available || document.hidden) return null
    const { rect, change } = shown
    const rootBounds = rootRef.current?.getBoundingClientRect()
    const labelBelow = rect.top - (rootBounds?.top || 0) < 40
    const labelTop = Math.max(
        rootBounds?.top || 0,
        Math.min(
            labelBelow ? rect.top + rect.height + 8 : rect.top - 34,
            (rootBounds?.bottom || window.innerHeight) - 30
        )
    )
    return createPortal(
        <div
            className="anna-reveal-overlay"
            data-anna-highlight-ui
            key={change.id}
            style={
                rootBounds && {
                    clipPath: `inset(${Math.max(0, rootBounds.top)}px ${Math.max(0, window.innerWidth - rootBounds.right)}px ${Math.max(0, window.innerHeight - rootBounds.bottom)}px ${Math.max(0, rootBounds.left)}px)`,
                }
            }
        >
            <div className="anna-reveal-ring" style={rect} aria-hidden="true" />
            <div
                className="anna-reveal-label"
                role="status"
                style={{
                    left: rect.left + 8,
                    top: labelTop,
                    maxWidth: Math.max(0, rect.width - 16),
                }}
            >
                <span className="anna-reveal-check" aria-hidden="true">
                    ✓
                </span>
                <span className="anna-reveal-label-text">
                    {translate(
                        change.change === 'created' ? 'Created by %{assistantName}' : 'Updated by %{assistantName}',
                        { assistantName }
                    )}
                </span>
            </div>
        </div>,
        document.body
    )
}
