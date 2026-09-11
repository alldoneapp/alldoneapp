import React, { createContext, useContext, useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import { useSelector } from 'react-redux'
import useAssistantVoiceCall from './useAssistantVoiceCall'
import FloatingCallControls from './FloatingAssistantVoiceCall'

const VoiceCallContext = createContext(null)
export const useVoiceCall = () => useContext(VoiceCallContext)

// This stays outside AppContent's responsive navigator and route screens. Every
// launcher uses the same owner; a route unmount cannot release the microphone.
export function AssistantVoiceCallProvider({ children, userId }) {
    const call = useAssistantVoiceCall()
    const owner = useRef(userId)
    useEffect(() => {
        if (owner.current !== userId) call.cleanup(true, 'account_changed')
        owner.current = userId
    }, [userId, call.cleanup])
    return (
        <VoiceCallContext.Provider value={call}>
            {children}
            {Platform.OS === 'web' && <FloatingCallControls call={call} />}
        </VoiceCallContext.Provider>
    )
}

export default function ConnectedVoiceCallProvider({ children }) {
    const userId = useSelector(state => state.loggedUser?.uid)
    return <AssistantVoiceCallProvider userId={userId}>{children}</AssistantVoiceCallProvider>
}
