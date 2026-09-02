import { useEffect, useRef, useState } from 'react'

import { runHttpsCallableFunction } from '../../../utils/backends/firestore'

export const HEALTH_CHECKING = 'checking'
export const HEALTH_CONNECTED = 'connected'
export const HEALTH_RECONNECT_REQUIRED = 'reconnect_required'
export const HEALTH_UNKNOWN = 'unknown'

/**
 * Verifies every connected account when Settings > Integrations opens.
 *
 * The stored `authInvalid` flag is only written when something actually TRIED to use the
 * account, so an account nobody has touched since its grant died reads as healthy until
 * some background job happens to run. This asks the providers directly (the callable forces
 * a token refresh), which both answers the question and records the result — so a card that
 * was silently dead flips to the reconnect state on open (AT-2491).
 *
 * `unknown` is deliberately distinct from `reconnect_required`: an unreachable provider, an
 * offline client or a failed callable must never tell a user to reconnect a working mailbox.
 * Everything that is not a definite answer degrades to `unknown`, which renders nothing.
 */
export function useConnectionHealth(connectionIds = []) {
    const [healthByConnectionId, setHealthByConnectionId] = useState({})
    const requestedRef = useRef('')

    // Join on the ids, not the array identity: the connection objects are rebuilt on every
    // logged-user snapshot, which would otherwise re-run the whole check on unrelated writes.
    const key = [...connectionIds].sort().join(',')

    useEffect(() => {
        if (!key) return undefined
        // A reconnect re-renders this with the same ids; the flag write already updated the
        // card, and re-verifying would burn another refresh per account.
        if (requestedRef.current === key) return undefined
        requestedRef.current = key

        let cancelled = false
        const ids = key.split(',')
        setHealthByConnectionId(previous => {
            const next = { ...previous }
            ids.forEach(id => {
                next[id] = { status: HEALTH_CHECKING }
            })
            return next
        })

        runHttpsCallableFunction('checkConnectionHealthSecondGen', { connectionIds: ids })
            .then(response => {
                if (cancelled) return
                const results = Array.isArray(response?.results) ? response.results : []
                setHealthByConnectionId(previous => {
                    const next = { ...previous }
                    ids.forEach(id => {
                        const result = results.find(entry => entry?.connectionId === id)
                        next[id] = { status: result?.status || HEALTH_UNKNOWN }
                    })
                    return next
                })
            })
            .catch(error => {
                if (cancelled) return
                // Offline, a cold function, a transport failure — all "we could not ask".
                console.warn('[Integrations] Connection health check failed:', error?.message || error)
                setHealthByConnectionId(previous => {
                    const next = { ...previous }
                    ids.forEach(id => {
                        next[id] = { status: HEALTH_UNKNOWN }
                    })
                    return next
                })
            })

        return () => {
            cancelled = true
        }
    }, [key])

    return healthByConnectionId
}
