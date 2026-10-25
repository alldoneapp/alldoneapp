import { useCallback, useEffect, useRef } from 'react'

import {
    ARTIFACT_BRIDGE_PROTOCOL,
    BRIDGE_LIMITS,
    isBridgeHello,
    normalizeBridgeQuery,
} from '../../functions/Artifacts/artifactDataBridge'

const MINUTE_MS = 60 * 1000
const systemNow = () => Date.now()

function newSessionToken() {
    const bytes = new Uint8Array(16)
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes)
    else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

// The app's half of the live data bridge (functions/Artifacts/artifactDataBridge.js) for one framed
// artifact. It answers only that frame's window, only the document that said hello first — a
// second hello is a second document and ends the conversation, as does a second load — and within
// a query budget, so a page cannot turn a loop into thousands of Firestore reads.
//
// `runQuery(request)` answers one normalized question; results are kept for a short while so a
// dashboard that asks the same thing in several widgets reads it once. The state belongs to one
// frame showing one address, so the component using this is keyed by that address.
export default function useArtifactDataBridge({ frameRef, enabled, runQuery, now = systemNow }) {
    const loads = useRef(0)
    const session = useRef(null)
    const ended = useRef(false)
    const cache = useRef(new Map())
    const recent = useRef([])

    useEffect(() => {
        if (!enabled) return undefined

        const isOver = () => ended.current || loads.current > 1
        const reply = (target, message) => {
            if (isOver() || frameRef.current?.contentWindow !== target) return
            target.postMessage({ protocol: ARTIFACT_BRIDGE_PROTOCOL, type: 'result', ...message }, '*')
        }

        const onMessage = event => {
            const frameWindow = frameRef.current?.contentWindow
            if (!frameWindow || event.source !== frameWindow || isOver()) return
            if (isBridgeHello(event.data)) {
                if (session.current) {
                    ended.current = true
                    return
                }
                session.current = newSessionToken()
                return reply(frameWindow, { type: 'welcome', session: session.current })
            }
            const request = normalizeBridgeQuery(event.data)
            if (!request || !session.current || request.session !== session.current) return
            if (request.error) return reply(frameWindow, { id: request.id, error: request.error })

            const at = now()
            recent.current = recent.current.filter(time => at - time < MINUTE_MS)
            if (recent.current.length >= BRIDGE_LIMITS.queriesPerMinute) {
                return reply(frameWindow, { id: request.id, error: 'Too many questions. Try again in a minute.' })
            }
            recent.current.push(at)

            const key = JSON.stringify([request.name, request.params])
            let entry = cache.current.get(key)
            if (!entry || at - entry.at > BRIDGE_LIMITS.cacheMs) {
                const { id, name, params } = request
                entry = { at, result: Promise.resolve().then(() => runQuery({ id, name, params })) }
                cache.current.set(key, entry)
            }
            entry.result.then(
                result => reply(frameWindow, { id: request.id, result }),
                error => {
                    cache.current.delete(key)
                    console.warn('[artifacts] Live data query failed', { name: request.name, error })
                    reply(frameWindow, { id: request.id, error: 'Alldone could not load this data.' })
                }
            )
        }

        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
    }, [enabled, runQuery, frameRef, now])

    // Every load after the first is the frame showing another page.
    return useCallback(() => {
        loads.current += 1
    }, [])
}
