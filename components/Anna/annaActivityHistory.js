const PREFIX = 'alldone.annaActivity.v1:'
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value)
const validNotice = (notice, userId) =>
    notice?.userId === userId &&
    validId(userId) &&
    validId(notice.projectId) &&
    validId(notice.chatId) &&
    validId(notice.sourceProjectId) &&
    ['feed', 'chat'].includes(notice.kind) &&
    typeof notice.id === 'string' &&
    notice.id.startsWith(`${notice.kind}/${notice.sourceProjectId}/`) &&
    Number.isFinite(notice.created) &&
    notice.path ===
        `/projects/${notice.sourceProjectId}/user/${userId}/${notice.kind === 'feed' ? 'updates' : 'chats'}/followed` &&
    typeof notice.projectName === 'string' &&
    (notice.entryText === undefined || typeof notice.entryText === 'string')

// Each arrival has its own immutable key. Reading/clearing the inbox cannot delete history,
// and another tab saving a different arrival cannot replace this tab's history. There is no
// age/count eviction: older notices appear with their conversation when earlier days are loaded.
export const createAnnaActivityHistory = (storage = () => localStorage) => {
    const userPrefix = userId => `${PREFIX}${encodeURIComponent(userId)}:`
    return {
        read(userId) {
            if (!validId(userId)) return []
            const notices = []
            try {
                const target = storage()
                for (let index = 0; index < target.length; index++) {
                    const key = target.key(index)
                    if (!key?.startsWith(userPrefix(userId))) continue
                    try {
                        const notice = JSON.parse(target.getItem(key))
                        if (validNotice(notice, userId)) notices.push(notice)
                    } catch (_) {}
                }
            } catch (_) {}
            return notices.sort((a, b) => a.created - b.created || a.id.localeCompare(b.id))
        },
        append(userId, notice) {
            const entry = { ...notice, userId }
            if (!validNotice(entry, userId)) return notice
            try {
                const target = storage()
                const key = userPrefix(userId) + encodeURIComponent(notice.id)
                const existing = JSON.parse(target.getItem(key) || 'null')
                if (validNotice(existing, userId)) return existing
                target.setItem(key, JSON.stringify(entry))
            } catch (_) {
                // A storage restriction must not hide a live arrival. The mounted conversation
                // still keeps the row, even when this browser cannot persist it across reloads.
            }
            return entry
        },
    }
}

export const annaActivityHistory = createAnnaActivityHistory()
