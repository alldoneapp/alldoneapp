import { useEffect, useState } from 'react'
import { useDispatch } from 'react-redux'
import v4 from 'uuid/v4'

import {
    resetLoadingData,
    setAssistantEnabled,
    setNotEnabledAssistantWhenLoadComments,
    setShowNotificationAboutTheBotBehavior,
    startLoadingData,
} from '../../redux/actions'
import store from '../../redux/store'
import { getAssistant } from '../../components/AdminPanel/Assistants/assistantsHelper'
import { watchComments } from '../../utils/backends/Chats/chatsComments'
import { unwatch } from '../../utils/backends/firestore'

const useGetMessages = (checkAssistant, showSpinner, projectId, objectId, chatType, toRender = 10000) => {
    const dispatch = useDispatch()
    const [messages, setMessages] = useState([])
    const [firstFetch, setFirstFetch] = useState(true)

    useEffect(() => {
        if (showSpinner) dispatch(startLoadingData())
        const watcherKey = v4()
        watchComments(projectId, chatType, objectId, watcherKey, toRender, handleSnapshot)
        return () => {
            unwatch(watcherKey)
        }
    }, [toRender, projectId, chatType, objectId])

    function handleSnapshot(snapshotMessages) {
        const sortedMessages = [...snapshotMessages].sort((a, b) => {
            const aLastChange = a?.lastChangeDate ?? 0
            const bLastChange = b?.lastChangeDate ?? 0
            if (aLastChange !== bLastChange) return aLastChange - bLastChange

            const aCreated = a?.created ?? 0
            const bCreated = b?.created ?? 0
            if (aCreated !== bCreated) return aCreated - bCreated

            return (a?.id || '').localeCompare(b?.id || '')
        })

        if (checkAssistant && firstFetch) {
            const { notEnabledAssistantWhenLoadComments, loggedUser } = store.getState()
            setFirstFetch(false)
            const lastMessage = sortedMessages[sortedMessages.length - 1]
            const assistantResponded =
                !!lastMessage && (lastMessage.fromAssistant || !!getAssistant(lastMessage.creatorId))
            if (assistantResponded) {
                if (!loggedUser.noticeAboutTheBotBehavior) dispatch(setShowNotificationAboutTheBotBehavior(true))

                if (notEnabledAssistantWhenLoadComments) {
                    dispatch(setNotEnabledAssistantWhenLoadComments(false))
                } else if (loggedUser.gold > 0) {
                    dispatch(setAssistantEnabled(true))
                }
            }
        }
        setMessages(sortedMessages)
        if (showSpinner) dispatch(resetLoadingData())
    }

    return messages
}

export default useGetMessages
