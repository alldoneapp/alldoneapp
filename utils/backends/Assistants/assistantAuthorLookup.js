import { getDb } from '../firestore'

const pendingLookups = new Map()

// Probe only this author's document. Loading every project's assistant collection here would
// undo lazy project loading whenever a chat contains an author we have not seen yet.
export function findAssistantAuthor(assistantId, projectIds, requestUserId) {
    if (!assistantId || !requestUserId) return Promise.resolve(null)
    const projects = [...new Set(['globalProject', ...projectIds])]
    const key = JSON.stringify([requestUserId, assistantId, projects])
    if (pendingLookups.has(key)) return pendingLookups.get(key)

    const lookup = (async () => {
        for (let offset = 0; offset < projects.length; offset += 4) {
            const results = await Promise.allSettled(
                projects.slice(offset, offset + 4).map(async projectId => {
                    const snapshot = await getDb().doc(`assistants/${projectId}/items/${assistantId}`).get()
                    return snapshot.exists ? { ...snapshot.data(), uid: assistantId } : null
                })
            )
            const match = results.find(result => result.status === 'fulfilled' && result.value)
            if (match) return match.value
        }
        return null
    })().finally(() => pendingLookups.delete(key))
    pendingLookups.set(key, lookup)
    return lookup
}
