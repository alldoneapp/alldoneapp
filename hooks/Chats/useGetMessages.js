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

        const decoratedMessages = snapshotMessages.map((message, index) => ({
            message,
            snapshotIndex: index,
        }))

        const sortedMessages = decoratedMessages
            .sort((a, b) => {
                const aLastChange = toMillis(a.message?.lastChangeDate)
                const bLastChange = toMillis(b.message?.lastChangeDate)
                if (aLastChange !== bLastChange) return aLastChange - bLastChange

                const aCreated = toMillis(a.message?.created)
                const bCreated = toMillis(b.message?.created)
                if (aCreated !== bCreated) return aCreated - bCreated

                // Firestore snapshot returns newest first when ordered desc.
                // When timestamps match, prefer the older message (higher snapshot index).
                if (a.snapshotIndex !== b.snapshotIndex) return b.snapshotIndex - a.snapshotIndex

                return (a.message?.id || '').localeCompare(b.message?.id || '')
            })
            .map(item => item.message)

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
