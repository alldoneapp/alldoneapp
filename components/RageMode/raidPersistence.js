// End-of-game requests can outlive the arena (exit/navigation). A new arena for the same user
// must wait before reading the profile or flying, including when the old canvas is already gone.
const pending = new Map()

export const trackRagePersistence = (scope, request) => {
    const key = scope || 'anonymous'
    const requests = pending.get(key) || new Set()
    pending.set(key, requests)
    const tracked = Promise.resolve(request).finally(() => {
        requests.delete(tracked)
        if (!requests.size) pending.delete(key)
    })
    requests.add(tracked)
    return tracked
}

export const waitForRagePersistence = async scope => {
    const key = scope || 'anonymous'
    while (pending.has(key)) await Promise.allSettled([...pending.get(key)])
}
