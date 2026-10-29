import { useEffect, useState } from 'react'

// Navigation hints belong to this client's conversation view. They must not
// post user messages, invoke the assistant, or leak into another user's chat.
//
// AT-2914: only the view that is open NOW is shown — one indicator, not a
// history of every page visited. It keeps the time the view was opened, is
// replaced on the next navigation, and disappears while no view is open
// (chat-only mode). The conversation renders it at the end of the current thread.
export default function useAnnaContextNotices(userId, conversation, pageContext) {
    const [state, setState] = useState({ userId, sequence: 0, notice: null })
    const { projectId, id: chatId } = conversation
    const surface = pageContext?.surface
    const path = pageContext?.path?.split(/[?#]/)[0] || ''
    const title = (pageContext?.title || '')
        .replace(/^Alldone(?:\.app)?(?:\s*[|–-]\s*|$)/i, '')
        .replace(/\s*[|–-]\s*Alldone.*$/i, '')
        .trim()
    const open = !!(userId && projectId && chatId && surface && title)
    const key = open ? JSON.stringify([projectId, chatId, surface, path, title]) : null

    useEffect(() => {
        if (!key) return
        const created = Date.now()
        setState(previous => {
            const notice = previous.userId === userId ? previous.notice : null
            if (notice?.key === key) return previous
            const sequence = previous.sequence + 1
            return { userId, sequence, notice: { id: sequence, key, projectId, chatId, title, created } }
        })
    }, [userId, key])

    return state.userId === userId && state.notice?.key === key ? state.notice : null
}
