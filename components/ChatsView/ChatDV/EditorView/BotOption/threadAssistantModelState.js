import { useCallback, useEffect, useState } from 'react'

import {
    canOverrideThreadAssistantModel,
    readThreadAssistantModelOverride,
    setThreadAssistantModelOverride,
} from '../../../../../utils/backends/Assistants/threadAssistantModel'

/**
 * Shared client state for a thread's pinned assistant model (AT-2502).
 *
 * Three surfaces need the same answer at the same time: the assistant button (which badges the
 * avatar when the thread is pinned), the row inside the assistant popup, and the picker itself.
 * They are in different subtrees and reached from four different entry points — the chat
 * composer, the chat bot line, the detail-view header avatar and the rich comment modal — so
 * threading the value down as a prop would mean touching every one of them and would still leave
 * the composer, which is handed a synthetic parent object rather than the real thread.
 *
 * Hence one tiny module-level cache keyed by thread, seeded by a single document read and
 * updated optimistically on selection. Deliberately NOT redux: the value concerns one thread,
 * and per AT-2336 a slice keyed by object id re-renders every subscriber on every write.
 *
 * The cache is not a snapshot listener. Nothing else in the app writes this field, so the only
 * writer is the picker in front of the user, and paying a listener per opened thread to observe
 * our own writes would be pure cost. A pin made in another tab is picked up on the next load.
 */

const cache = new Map()
const inFlight = new Map()
const subscribers = new Set()

const getCacheKey = (projectId, objectId) => `${projectId}__${objectId}`

const notify = () => {
    subscribers.forEach(listener => {
        try {
            listener()
        } catch (error) {
            console.warn('[threadAssistantModel] subscriber failed:', error)
        }
    })
}

export const getCachedThreadAssistantModel = (projectId, objectId) => {
    const cached = cache.get(getCacheKey(projectId, objectId))
    return cached === undefined ? null : cached
}

export const primeThreadAssistantModel = (projectId, objectId, model) => {
    const key = getCacheKey(projectId, objectId)
    if (cache.get(key) === (model || null)) return
    cache.set(key, model || null)
    notify()
}

// Exported for tests: module-level state outlives a test file otherwise.
export const resetThreadAssistantModelCache = () => {
    cache.clear()
    inFlight.clear()
}

const loadOnce = (projectId, objectId, objectType) => {
    const key = getCacheKey(projectId, objectId)
    if (cache.has(key)) return Promise.resolve(cache.get(key))
    if (inFlight.has(key)) return inFlight.get(key)

    const request = readThreadAssistantModelOverride(projectId, objectId, objectType)
        .then(model => {
            cache.set(key, model || null)
            notify()
            return cache.get(key)
        })
        .catch(() => null)
        .finally(() => {
            inFlight.delete(key)
        })

    inFlight.set(key, request)
    return request
}

/**
 * `{ model, isSupported, updateModel }` for a thread.
 *
 * `model` is null while the first read is in flight and for a thread that follows its assistant —
 * the two are deliberately indistinguishable to callers, because both mean "draw nothing extra".
 * A badge that flickered on during loading would be worse than one that appears a beat late.
 */
export const useThreadAssistantModel = (projectId, objectId, objectType) => {
    const isSupported = !!projectId && !!objectId && canOverrideThreadAssistantModel(projectId, objectId, objectType)
    const [model, setModel] = useState(() => (isSupported ? getCachedThreadAssistantModel(projectId, objectId) : null))

    useEffect(() => {
        if (!isSupported) {
            setModel(null)
            return undefined
        }

        let active = true
        const sync = () => {
            if (active) setModel(getCachedThreadAssistantModel(projectId, objectId))
        }

        subscribers.add(sync)
        sync()
        loadOnce(projectId, objectId, objectType).then(sync)

        return () => {
            active = false
            subscribers.delete(sync)
        }
    }, [projectId, objectId, objectType, isSupported])

    const updateModel = useCallback(
        async selection => {
            if (!isSupported) return null
            // Optimistic first: the popup closes on selection, so the badge must already be
            // right when the user looks back at the button.
            const stored = await setThreadAssistantModelOverride(projectId, objectId, objectType, selection)
            primeThreadAssistantModel(projectId, objectId, stored)
            return stored
        },
        [projectId, objectId, objectType, isSupported]
    )

    return { model, isSupported, updateModel }
}
