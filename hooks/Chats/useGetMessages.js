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

    function handleSnapshot(messages) {
        messages.reverse()

        if (checkAssistant && firstFetch) {
            const { notEnabledAssistantWhenLoadComments, loggedUser } = store.getState()
            setFirstFetch(false)
            if (messages.length > 0 && getAssistant(messages[messages.length - 1].creatorId)) {
                if (!loggedUser.noticeAboutTheBotBehavior) dispatch(setShowNotificationAboutTheBotBehavior(true))

                if (notEnabledAssistantWhenLoadComments) {
                    dispatch(setNotEnabledAssistantWhenLoadComments(false))
                } else if (loggedUser.gold > 0) {
                    dispatch(setAssistantEnabled(true))
                }
            }
        }
        setMessages(messages)
        if (showSpinner) dispatch(resetLoadingData())
    }

    return messages
}

export default useGetMessages
