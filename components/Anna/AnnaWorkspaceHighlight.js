import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getDb } from '../../utils/backends/firestore'
import { translate } from '../../i18n/TranslationService'
import { createHighlightTargetRegistry, resolveHighlightRects } from './annaHighlightTargets'

export default function AnnaWorkspaceHighlight({ rootRef, active, conversation, routeId }) {
    const [shown, setShown] = useState(null)
    const current = useRef({ snapshot: null, references: new Map() })
    const activeCommand = useRef(null)
    const seen = useRef(null)
    const command = conversation?.annaHighlight
    const docPath = conversation && `chatObjects/${conversation.projectId}/chats/${conversation.id}`
    const update = patch =>
        docPath &&
        getDb()
            .doc(docPath)
            .update(patch)
            .catch(() => {})
    const dismiss = status => {
        const previous = activeCommand.current
        activeCommand.current = null
        setShown(null)
        if (previous) update({ annaHighlightStatus: { id: previous.id, status, at: Date.now() } })
    }

    useEffect(() => {
        if (!docPath) return
        let stopped = false
        let publishing = false
        let publishedKey = null
        const collect = createHighlightTargetRegistry()
        const session = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        let revision = 0
        let inventoryKey = ''
        const tick = async () => {
            if (stopped || publishing) return
            const visible = active && !document.hidden
            const { targets, references } = visible ? collect(rootRef.current) : { targets: [], references: new Map() }
            const path = window.location.pathname
            const key = JSON.stringify({ path, targets, visible })
            if (key !== inventoryKey) {
                inventoryKey = key
                current.current = {
                    snapshot: visible ? { id: `${session}-${++revision}`, path, targets } : null,
                    references,
                }
            } else current.current.references = references
            if (key === publishedKey) return
            publishing = true
            try {
                await getDb().doc(docPath).update({ annaScreenContext: current.current.snapshot })
                if (!stopped) publishedKey = key
            } catch (_) {
                /* Retry only the current screen. */
            } finally {
                publishing = false
            }
        }
        // Polling also checks document.hidden; appResume owns visibility listeners.
        // Throttle inventory updates while a user scrolls or an editor changes.
        tick()
        const timer = setInterval(tick, 750)
        return () => {
            stopped = true
            clearInterval(timer)
            current.current = { snapshot: null, references: new Map() }
        }
    }, [docPath, active, routeId])

    useEffect(() => {
        if (!active || document.hidden) {
            dismiss('cleared')
            return
        }
        const refresh = () => {
            const previous = activeCommand.current
            if (!previous) return
            if (document.hidden) {
                dismiss('cleared')
                return
            }
            if (previous.expiresAt <= Date.now()) {
                dismiss('expired')
                return
            }
            // Keep the accepted snapshot identity while scrolling; text/node identity is rechecked.
            const rectangles = resolveHighlightRects(previous, previous.snapshot, previous.references, rootRef.current)
            if (!rectangles.length) {
                dismiss('target_not_visible')
                return
            }
            setShown({ command: previous, rectangles })
        }
        const timer = setInterval(refresh, 150)
        const escape = event => {
            if (event.key === 'Escape') dismiss('dismissed')
        }
        window.addEventListener('keydown', escape)
        window.addEventListener('scroll', refresh, true)
        window.addEventListener('resize', refresh)
        return () => {
            clearInterval(timer)
            window.removeEventListener('keydown', escape)
            window.removeEventListener('scroll', refresh, true)
            window.removeEventListener('resize', refresh)
            dismiss('cleared')
        }
    }, [active, routeId, docPath])

    useEffect(() => {
        if (!command || seen.current === command.id) return
        seen.current = command.id
        if (command.action === 'clear') {
            dismiss('cleared')
            update({ annaHighlightStatus: { id: command.id, status: 'cleared', at: Date.now() } })
            return
        }
        const rectangles =
            active &&
            !document.hidden &&
            resolveHighlightRects(command, current.current.snapshot, current.current.references, rootRef.current)
        if (!rectangles?.length) {
            dismiss('cleared')
            update({ annaHighlightStatus: { id: command.id, status: 'target_not_visible', at: Date.now() } })
            return
        }
        const accepted = { ...command, snapshot: current.current.snapshot, references: current.current.references }
        activeCommand.current = accepted
        setShown({ command: accepted, rectangles })
        update({ annaHighlightStatus: { id: command.id, status: 'shown', at: Date.now() } })
    }, [command?.id, active])

    if (!shown) return null
    const bounds = rootRef.current?.getBoundingClientRect()
    const captionAtBottom = bounds && shown.rectangles[0].top < (bounds.top + bounds.bottom) / 2
    return (
        <>
            {createPortal(
                <div className="anna-highlight-overlay" aria-hidden="true" data-anna-highlight-ui>
                    {shown.rectangles.map((rect, index) => (
                        <span
                            key={index}
                            className={`anna-highlight-${shown.command.style || 'marker'}`}
                            style={rect}
                        />
                    ))}
                </div>,
                document.body
            )}
            <div
                className="anna-highlight-caption"
                style={captionAtBottom ? { top: 'auto', bottom: 8 } : undefined}
                role="status"
                data-anna-highlight-ui
            >
                <span>
                    {translate('Anna is pointing to:')}{' '}
                    {shown.command.label || shown.command.quote || shown.command.text}
                </span>
                <button onClick={() => dismiss('dismissed')} aria-label={translate('Clear highlight')}>
                    ×
                </button>
            </div>
        </>
    )
}
