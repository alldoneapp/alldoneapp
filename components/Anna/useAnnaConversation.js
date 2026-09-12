import { useEffect, useState } from 'react'
import { getDb, runHttpsCallableFunction } from '../../utils/backends/firestore'

export default function useAnnaConversation(userId) {
    const [state, setState] = useState({ loading: true, conversation: null, error: '' })
    const [attempt, setAttempt] = useState(0)
    useEffect(() => {
        let cancelled = false
        let unsubscribe
        setState({ loading: true, conversation: null, error: '' })
        runHttpsCallableFunction('getAnnaConversationSecondGen', {})
            .then(reference => {
                if (cancelled) return
                unsubscribe = getDb()
                    .doc(`chatObjects/${reference.projectId}/chats/${reference.chatId}`)
                    .onSnapshot(
                        snapshot => {
                            if (cancelled) return
                            if (!snapshot.exists) {
                                setState({
                                    loading: false,
                                    conversation: null,
                                    error: 'Your conversation could not be found.',
                                })
                                return
                            }
                            setState({
                                loading: false,
                                error: '',
                                conversation: { ...snapshot.data(), ...reference, id: reference.chatId },
                            })
                        },
                        () =>
                            !cancelled &&
                            setState(previous => ({
                                ...previous,
                                loading: false,
                                error: 'Your conversation could not be loaded. Please try again.',
                            }))
                    )
            })
            .catch(error => {
                if (!cancelled)
                    setState({
                        loading: false,
                        conversation: null,
                        error: error.message || 'Anna could not connect. Please try again.',
                    })
            })
        return () => {
            cancelled = true
            unsubscribe?.()
        }
    }, [userId, attempt])
    return { ...state, retry: () => setAttempt(value => value + 1) }
}
