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
    const [state, setState] = useState({ messages: [], loaded: false })

    useEffect(() => {
        if (showSpinner) dispatch(startLoadingData())
        let isFirstFetch = true
        const watcherKey = v4()
        watchComments(projectId, chatType, objectId, watcherKey, toRender, handleSnapshot)

        function handleSnapshot(snapshotMessages) {
            const toMillis = value => {
                if (!value) return 0
                if (typeof value === 'number') return value
                if (typeof value === 'string') {
                    const numericValue = Number(value)
                    if (Number.isFinite(numericValue)) return numericValue
                    const dateValue = Date.parse(value)
                    return Number.isFinite(dateValue) ? dateValue : 0
                }
                if (typeof value.toMillis === 'function') return value.toMillis()
                if (value.seconds !== undefined) {
                    const millis = value.seconds * 1000
                    const nanos = value.nanoseconds ? Math.floor(value.nanoseconds / 1000000) : 0
                    return millis + nanos
                }
                if (typeof value.valueOf === 'function') {
                    const numericValue = value.valueOf()
                    if (Number.isFinite(numericValue)) return numericValue
                }
                if (typeof value.getTime === 'function') return value.getTime()
                return 0
            }

            // Keep chronological order strictly based on creation time so edits do not reorder comments
            const sortedMessages = [...snapshotMessages].sort((a, b) => {
                const aCreated = toMillis(a?.created) || toMillis(a?.lastChangeDate)
                const bCreated = toMillis(b?.created) || toMillis(b?.lastChangeDate)
                if (aCreated !== bCreated) return aCreated - bCreated

                return (a?.id || '').localeCompare(b?.id || '')
            })

            if (checkAssistant && isFirstFetch) {
                const { notEnabledAssistantWhenLoadComments, loggedUser } = store.getState()
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
            isFirstFetch = false
            setState({ messages: sortedMessages, loaded: true })
            if (showSpinner) dispatch(resetLoadingData())
        }

        return () => {
            unwatch(watcherKey)
        }
    }, [toRender, projectId, chatType, objectId])

    const messagesWithLoaded = [...state.messages]
    messagesWithLoaded.loaded = state.loaded
    return messagesWithLoaded
}

export default useGetMessages
