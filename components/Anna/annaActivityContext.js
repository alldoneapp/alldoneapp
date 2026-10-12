import { getDb } from '../../utils/backends/firestore'
import { normalizeAssistantActivityNotice } from '../../functions/shared/assistantActivityContext'

const pending = new Map()
const saved = new Map()

// Sync only notices already rendered in the user's assistant timeline. Each notice
// has its own document, so another tab cannot overwrite the rest of the history.
export function publishAnnaActivityContext(userId, notice) {
    const normalized = normalizeAssistantActivityNotice(notice, userId)
    if (!normalized) return Promise.resolve()
    const key = `${userId}/${encodeURIComponent(normalized.id)}`
    const signature = JSON.stringify(normalized)
    if (saved.get(key) === signature) return Promise.resolve()
    if (pending.get(key)?.signature === signature) return pending.get(key).promise
    const prior = pending.get(key)?.promise || Promise.resolve()
    const promise = prior
        .catch(() => {})
        .then(() =>
            getDb()
                .doc(`users/${userId}/private/assistantActivity/notices/${encodeURIComponent(normalized.id)}`)
                .set(normalized, { merge: true })
        )
        .then(() => {
            saved.set(key, signature)
            if (saved.size > 500) saved.delete(saved.keys().next().value)
        })
        .finally(() => {
            if (pending.get(key)?.promise === promise) pending.delete(key)
        })
    pending.set(key, { signature, promise })
    return promise
}

export async function flushAnnaActivityContext(userId) {
    await Promise.allSettled(
        [...pending.entries()].filter(([key]) => key.startsWith(`${userId}/`)).map(([, job]) => job.promise)
    )
}
