import { useCallback, useEffect, useRef, useState } from 'react'
import { getDb, runHttpsCallableFunction } from '../../utils/backends/firestore'
import { subscribePageVisible } from '../../utils/appResume'

const threadKey = thread => `${thread.projectId}/${thread.chatId || thread.id}`
export default function useAnnaConversation(userId, { enabled = true, user = {}, hold = false } = {}) {
    const [state, setState] = useState({ loading: true, conversation: null, error: '', threads: [], nextBefore: null })
    const [reference, setReference] = useState(null)
    const generation = useRef(0)
    const flight = useRef(null)
    const nextRollover = useRef(0)
    const holdRef = useRef(hold)
    holdRef.current = hold
    const resolveConversation = useCallback(async () => {
        if (!userId) return null
        if (flight.current) return flight.current
        const currentGeneration = generation.current
        const request = runHttpsCallableFunction('getAnnaConversationSecondGen', {})
            .then(result => {
                if (currentGeneration !== generation.current) return null
                nextRollover.current = result.nextRolloverAt || Date.now() + 30000
                setReference(result)
                setState(previous => {
                    const threads = new Map(previous.threads.map(thread => [threadKey(thread), thread]))
                    ;(result.threads || [result]).forEach(thread => threads.set(threadKey(thread), thread))
                    return {
                        ...previous,
                        error: '',
                        threads: [...threads.values()].sort((a, b) => a.created - b.created),
                        nextBefore: previous.threads.length ? previous.nextBefore : result.nextBefore,
                    }
                })
                return { ...result, id: result.chatId }
            })
            .catch(error => {
                if (currentGeneration === generation.current)
                    setState(previous => ({
                        ...previous,
                        loading: false,
                        error: error.message || 'Your conversation could not be loaded. Please try again.',
                    }))
                throw error
            })
            .finally(() => {
                if (flight.current === request) flight.current = null
            })
        flight.current = request
        return request
    }, [
        userId,
        user.defaultProjectId,
        user.timezone,
        user.preferredTimezone,
        user.timezoneOffset,
        user.timezoneMinutes,
    ])

    useEffect(() => {
        generation.current++
        flight.current = null
        nextRollover.current = 0
        setReference(null)
        setState({ loading: true, conversation: null, error: '', threads: [], nextBefore: null })
        return () => {
            generation.current++
            flight.current = null
        }
    }, [userId])

    useEffect(() => {
        generation.current++
        flight.current = null
    }, [resolveConversation])

    useEffect(() => {
        if (!enabled || !userId) return
        resolveConversation().catch(() => {})
        const refresh = () => {
            if (!holdRef.current && !document.hidden && Date.now() >= nextRollover.current)
                resolveConversation().catch(() => {})
        }
        const timer = setInterval(refresh, 30000)
        const stop = subscribePageVisible(refresh)
        return () => {
            clearInterval(timer)
            stop()
        }
    }, [enabled, userId, resolveConversation])

    useEffect(() => {
        if (!reference?.chatId) return
        return getDb()
            .doc(`chatObjects/${reference.projectId}/chats/${reference.chatId}`)
            .onSnapshot(
                snapshot => {
                    if (!snapshot.exists) {
                        setState(previous => ({
                            ...previous,
                            loading: false,
                            error: 'Your conversation could not be found.',
                        }))
                        return
                    }
                    setState(previous => ({
                        ...previous,
                        loading: false,
                        error: '',
                        conversation: {
                            ...snapshot.data(),
                            projectId: reference.projectId,
                            id: reference.chatId,
                            assistantId: reference.assistantId,
                        },
                    }))
                },
                error => setState(previous => ({ ...previous, loading: false, error: error.message }))
            )
    }, [reference?.projectId, reference?.chatId, reference?.assistantId])

    const loadEarlier = async () => {
        if (state.nextBefore == null) return
        const currentGeneration = generation.current
        const result = await runHttpsCallableFunction('getAnnaConversationSecondGen', { before: state.nextBefore })
        if (currentGeneration !== generation.current) return
        setState(previous => {
            const threads = new Map(previous.threads.map(thread => [threadKey(thread), thread]))
            result.threads.forEach(thread => threads.set(threadKey(thread), thread))
            return {
                ...previous,
                threads: [...threads.values()].sort((a, b) => a.created - b.created),
                nextBefore: result.nextBefore,
            }
        })
    }
    return { ...state, resolveConversation, loadEarlier, retry: () => resolveConversation().catch(() => {}) }
}
