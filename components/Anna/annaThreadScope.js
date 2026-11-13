// AT-3036 — which threads the assistant chat shows. Every project has its own daily thread
// (`AnnaChat{YYYYMMDD}{uid}`), so the chat shows the threads of the project it continues in and
// lists the other projects' threads only as jumps. Pure, for the conversation and its tests.

const threadId = thread => thread?.chatId || thread?.id
const sameThread = (a, b) => a.projectId === b.projectId && threadId(a) === threadId(b)
const list = value => (Array.isArray(value) ? value : [])

/**
 * `threads` / `otherThreads` come from useAnnaConversation (already split by project);
 * `localThreads` are the threads of pending or failed sends. Returns the threads to show, the
 * current one last (AT-2903: the composer writes into it), and the projects to offer as jumps,
 * the most recently active first.
 */
export function scopeAnnaThreads({
    conversation,
    threads,
    otherThreads = [],
    localThreads = [],
    canOpen = () => true,
}) {
    const projectId = conversation?.projectId
    const current = { ...conversation, chatId: conversation?.id }
    const shown = [...(threads || [current])].filter(thread => !projectId || thread.projectId === projectId)
    const others = [...list(otherThreads)]
    list(localThreads).forEach(thread => {
        if (!thread?.id || !thread.projectId) return
        if (projectId && thread.projectId !== projectId) others.push(thread)
        else if (!shown.some(item => sameThread(item, thread))) shown.push(thread)
    })
    const currentIndex = shown.findIndex(thread => sameThread(thread, current))
    if (currentIndex >= 0 && currentIndex < shown.length - 1) shown.push(...shown.splice(currentIndex, 1))
    const latest = new Map()
    others.forEach(thread => {
        if (!thread?.projectId || thread.projectId === projectId) return
        const created = Number(thread.created) || 0
        if (!latest.has(thread.projectId) || latest.get(thread.projectId) < created)
            latest.set(thread.projectId, created)
    })
    const otherProjectIds = [...latest.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => id)
        .filter(id => canOpen(id))
    return { threads: shown, otherProjectIds }
}
