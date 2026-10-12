import { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { commentOutbox, subscribeCommentOutbox } from '../../utils/backends/Chats/commentOutbox'

// The outbox acknowledges delivery before the listener necessarily sees the
// document. Retain that echo until the same permanent ID reaches the snapshot.
export default function usePendingChatMessages(messages, projectId, objectId, objectType) {
    const userId = useSelector(state => state.loggedUser?.uid)
    const scope = JSON.stringify([userId, projectId, objectId, objectType])
    const readEntries = () =>
        commentOutbox
            .list(userId)
            .filter(
                entry =>
                    entry.projectId === projectId &&
                    entry.objectId === objectId &&
                    (entry.objectType === objectType ||
                        (['users', 'contacts'].includes(entry.objectType) &&
                            ['users', 'contacts'].includes(objectType)))
            )
    const [state, setState] = useState(() => ({ scope, entries: readEntries() }))
    const entries = state.scope === scope ? state.entries : readEntries()
    const savedIds = new Set(messages.map(message => message.id))
    const savedKey = JSON.stringify([...savedIds])

    useEffect(() => {
        const refresh = () => {
            const pending = readEntries()
            setState(previous => {
                const retained = previous.scope === scope ? previous.entries : []
                const byId = new Map(retained.map(entry => [entry.id, { ...entry, status: 'sent' }]))
                pending.forEach(entry => byId.set(entry.id, entry))
                return { scope, entries: [...byId.values()] }
            })
        }
        refresh()
        const unsubscribe = subscribeCommentOutbox(refresh)
        window.addEventListener('storage', refresh)
        return () => {
            unsubscribe()
            window.removeEventListener('storage', refresh)
        }
    }, [scope])

    useEffect(() => {
        setState(previous => {
            if (previous.scope !== scope) return previous
            const remaining = previous.entries.filter(entry => entry.status !== 'sent' || !savedIds.has(entry.id))
            return remaining.length === previous.entries.length ? previous : { scope, entries: remaining }
        })
    }, [scope, savedKey, entries])

    const pendingById = new Map(entries.map(entry => [entry.id, entry]))
    return [
        ...messages.map(message => ({
            ...message,
            pendingSend: pendingById.get(message.id)?.status !== 'sent' ? pendingById.get(message.id) : undefined,
        })),
        ...entries
            .filter(entry => !savedIds.has(entry.id))
            .map(entry => ({
                id: entry.id,
                creatorId: entry.userId,
                commentText: entry.comment,
                created: entry.created,
                lastChangeDate: entry.created,
                fromAssistant: false,
                commentType: entry.commentType,
                pendingSend: entry.status !== 'sent' ? entry : undefined,
            })),
    ]
}
