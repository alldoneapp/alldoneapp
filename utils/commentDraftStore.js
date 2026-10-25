const PREFIX = 'alldone.commentDraft.v1:'
const volatile = new Map()
const keyFor = ({ userId, projectId, objectType, objectId }) =>
    `${PREFIX}${[userId, projectId, objectType, objectId].map(value => encodeURIComponent(value || '')).join(':')}`

export const readCommentDraft = context => {
    const key = keyFor(context)
    if (volatile.has(key)) return volatile.get(key)
    try {
        return JSON.parse(localStorage.getItem(key) || 'null')
    } catch (_) {
        return null
    }
}

export const saveCommentDraft = (context, draft) => {
    const key = keyFor(context)
    volatile.set(key, draft)
    try {
        localStorage.setItem(key, JSON.stringify(draft))
        volatile.delete(key)
        return true
    } catch (_) {
        return false
    }
}

export const clearCommentDraft = (context, submittedText) => {
    const current = readCommentDraft(context)
    if (current?.comment !== submittedText) return
    saveCommentDraft(context, { comment: '' })
}

export const hasUnsafeCommentDrafts = () => [...volatile.values()].some(draft => !!draft?.comment?.trim())
