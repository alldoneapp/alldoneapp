import { useEffect, useState } from 'react'

// Navigation hints belong to this client's conversation view. They must not
// post user messages, invoke the assistant, or leak into another user's chat.
export default function useAnnaContextNotices(userId, conversation, pageContext) {
    const [state, setState] = useState({ userId, sequence: 0, notices: [] })
    const { projectId, id: chatId } = conversation
    const surface = pageContext?.surface
    const path = pageContext?.path?.split(/[?#]/)[0] || ''
    const title = (pageContext?.title || '')
        .replace(/^Alldone(?:\.app)?(?:\s*[|–-]\s*|$)/i, '')
        .replace(/\s*[|–-]\s*Alldone.*$/i, '')
        .trim()

    useEffect(() => {
        if (!userId || !projectId || !chatId || !surface || !title) return
        const key = JSON.stringify([projectId, chatId, surface, path, title])
        const created = Date.now()
        setState(previous => {
            const notices = previous.userId === userId ? previous.notices : []
            if (notices.at(-1)?.key === key) return previous
            const sequence = previous.sequence + 1
            return {
                userId,
                sequence,
                notices: [...notices.slice(-99), { id: sequence, key, projectId, chatId, title, created }],
            }
        })
    }, [userId, projectId, chatId, surface, path, title])

    return state.userId === userId ? state.notices : []
}
