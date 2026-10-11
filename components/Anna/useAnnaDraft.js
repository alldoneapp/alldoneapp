import { useCallback, useEffect, useRef, useState } from 'react'
import { readCommentDraft, saveCommentDraft } from '../../utils/commentDraftStore'

// AnnaShell remounts the conversation when the account/default project changes.
export default function useAnnaDraft(context) {
    const storageContext = useRef(context)
    const [initialText] = useState(() => readCommentDraft(context)?.comment || '')
    const draft = useRef(initialText)
    const [hasText, setHasText] = useState(!!initialText.trim())
    const hasTextRef = useRef(hasText)
    const timer = useRef(null)
    const pending = useRef(false)

    const flush = useCallback(() => {
        clearTimeout(timer.current)
        timer.current = null
        if (!pending.current) return
        pending.current = false
        saveCommentDraft(storageContext.current, { comment: draft.current })
    }, [])

    const change = useCallback(
        text => {
            if (text === draft.current) return
            draft.current = text
            const nextHasText = !!text.trim()
            // The rich editor owns its live text. Only send-button availability
            // needs React state here; typing must not re-render the transcript.
            if (nextHasText !== hasTextRef.current) {
                hasTextRef.current = nextHasText
                setHasText(nextHasText)
            }
            pending.current = true
            clearTimeout(timer.current)
            // Clear immediately on send, so an older scheduled draft cannot return.
            if (!text) flush()
            else timer.current = setTimeout(flush, 250)
        },
        [flush]
    )

    useEffect(() => {
        const onVisibilityChange = () => {
            if (document.hidden) flush()
        }
        window.addEventListener('pagehide', flush)
        window.addEventListener('beforeunload', flush)
        document.addEventListener('visibilitychange', onVisibilityChange)
        return () => {
            flush()
            window.removeEventListener('pagehide', flush)
            window.removeEventListener('beforeunload', flush)
            document.removeEventListener('visibilitychange', onVisibilityChange)
        }
    }, [flush])

    return { initialText, draft, hasText, change }
}
