export const SUPPORTED_PROJECT_MOVE_TYPES = ['task', 'note', 'goal', 'contact', 'chat', 'skill']

export const isProjectMovePending = object =>
    object?.projectMove?.status === 'moving' || (!object?.projectMove?.status && !!object?.movingToOtherProjectId)

// The callable can take a round trip to write its source marker. Keep a local
// contact-only hint during that gap, scoped by source project and contact id.
const localContactMoves = new Map()
const contactMoveListeners = new Set()
const LOCAL_CONTACT_MOVE_TIMEOUT_MS = 300000
const contactMoveKey = (projectId, contactId) => `${projectId}:${contactId}`
const notifyContactMoveListeners = () => contactMoveListeners.forEach(listener => listener())

export const subscribeLocalContactMoves = listener => {
    contactMoveListeners.add(listener)
    return () => contactMoveListeners.delete(listener)
}

export const isLocalContactMovePending = (projectId, contactId) =>
    !!projectId && !!contactId && !!localContactMoves.get(contactMoveKey(projectId, contactId))?.size

export const beginLocalContactMove = (projectId, contactId) => {
    const key = contactMoveKey(projectId, contactId)
    const entries = localContactMoves.get(key) || new Set()
    localContactMoves.set(key, entries)
    let finished = false
    const finish = () => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        entries.delete(finish)
        if (!entries.size) localContactMoves.delete(key)
        notifyContactMoveListeners()
    }
    entries.add(finish)
    const timeout = setTimeout(finish, LOCAL_CONTACT_MOVE_TIMEOUT_MS)
    notifyContactMoveListeners()
    return finish
}

export const finishLocalContactMove = (projectId, contactId) => {
    const entry = localContactMoves.get(contactMoveKey(projectId, contactId))?.values().next().value
    entry?.()
}
