import { useEffect, useRef, useState } from 'react'
import { eventContainsFiles, getDroppedFiles } from '../Feeds/CommentsTextInput/attachmentFileUtils'

/**
 * AT-2928 — files dropped anywhere on the assistant chat pane attach to the composer.
 *
 * The pane is the target rather than the 48px editor line, because the composer is a small
 * part of a tall column and a drop on the message list, the header or the toolbar means the
 * same thing. Three rules, all load-bearing:
 *
 * - Listeners are NATIVE and in the CAPTURE phase on the pane. The composer's Quill editor
 *   runs its own `uploader` drop listener on `quill.root` (AT-2441); capture runs outside-in,
 *   so claiming the drop here means Quill never sees it and a file cannot land twice.
 * - Only drags that carry FILES are touched. A text selection dragged inside the editor and a
 *   `@hello-pangea/dnd` task drag (pointer events, no `dataTransfer`) pass through untouched.
 * - A file drop is always `preventDefault`ed, even when attaching is not possible right now
 *   (voice call, dictation, offline): otherwise the browser navigates away to the file.
 *
 * `getPane` resolves the element once after mount; `canAccept` and `onFiles` are read through
 * refs so the listeners are never re-attached between renders.
 */
export default function useAnnaFileDrop({ getPane, canAccept, onFiles }) {
    const [dragging, setDragging] = useState(false)
    const latest = useRef({ canAccept, onFiles })
    latest.current = { canAccept, onFiles }

    useEffect(() => {
        const pane = getPane?.()
        if (!pane || typeof window === 'undefined') return
        let depth = 0

        const reset = () => {
            depth = 0
            setDragging(false)
        }
        const accepting = () => !!latest.current.canAccept?.()
        const claim = event => {
            event.preventDefault()
            if (event.dataTransfer) event.dataTransfer.dropEffect = accepting() ? 'copy' : 'none'
        }

        const onDragEnter = event => {
            if (!eventContainsFiles(event)) return
            claim(event)
            depth += 1
            setDragging(accepting())
        }
        const onDragOver = event => {
            if (!eventContainsFiles(event)) return
            claim(event)
        }
        // Every child entered fires dragenter and every child left fires dragleave, so the
        // counter returns to zero exactly when the pointer has left the whole pane. Not keyed
        // on `relatedTarget`, which Safari reports as null for drag events.
        const onDragLeave = event => {
            if (!eventContainsFiles(event) || depth === 0) return
            depth -= 1
            if (depth === 0) setDragging(false)
        }
        const onDrop = event => {
            const files = getDroppedFiles(event)
            if (files.length === 0) return
            event.preventDefault()
            event.stopPropagation()
            reset()
            if (accepting()) latest.current.onFiles?.(files)
        }

        pane.addEventListener('dragenter', onDragEnter, true)
        pane.addEventListener('dragover', onDragOver, true)
        pane.addEventListener('dragleave', onDragLeave, true)
        pane.addEventListener('drop', onDrop, true)
        // A drag cancelled or dropped elsewhere must never leave the overlay up.
        window.addEventListener('drop', reset)
        window.addEventListener('dragend', reset)
        return () => {
            pane.removeEventListener('dragenter', onDragEnter, true)
            pane.removeEventListener('dragover', onDragOver, true)
            pane.removeEventListener('dragleave', onDragLeave, true)
            pane.removeEventListener('drop', onDrop, true)
            window.removeEventListener('drop', reset)
            window.removeEventListener('dragend', reset)
        }
    }, [])

    return dragging
}
