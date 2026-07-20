import { useEffect, useState } from 'react'
import moment from 'moment'

import { getUnreadChatIds } from '../../components/ChatsView/Utils/unreadChatFilter'
import useSelectorHashtagFilters from '../../components/HashtagFilters/UseSelectorHashtagFilters'
import { filterChats, filterStickyChats } from '../../components/HashtagFilters/FilterHelpers/FilterChats'
import { getDb } from '../../utils/backends/firestore'

const EMPTY_UNREAD_CHATS = { chats: {}, stickyChats: [] }

export const groupUnreadChats = chatDocs => {
    const chats = {}
    const stickyChats = []

    chatDocs.forEach(doc => {
        if (!doc.exists) return

        const chat = { ...doc.data(), id: doc.id }
        if (chat.stickyData?.days > 0) {
            stickyChats.push(chat)
        } else {
            const date = moment(chat.lastEditionDate).format('YYYYMMDD')
            if (!chats[date]) chats[date] = []
            chats[date].push(chat)
        }
    })

    return { chats, stickyChats }
}

export default function useGetUnreadChats(projectId, projectNotifications, chatsActiveTab, enabled) {
    const [, filtersArray] = useSelectorHashtagFilters()
    const [unreadChats, setUnreadChats] = useState(EMPTY_UNREAD_CHATS)
    const unreadChatIds = getUnreadChatIds(projectNotifications, chatsActiveTab)
    const unreadChatIdsKey = unreadChatIds.sort().join('|')

    useEffect(() => {
        let cancelled = false

        if (!enabled || unreadChatIds.length === 0) {
            setUnreadChats(EMPTY_UNREAD_CHATS)
            return () => {
                cancelled = true
            }
        }

        const loadUnreadChats = async () => {
            try {
                const docs = await Promise.all(
                    unreadChatIds.map(chatId => getDb().doc(`chatObjects/${projectId}/chats/${chatId}`).get())
                )
                if (cancelled) return

                const groupedChats = groupUnreadChats(docs)
                setUnreadChats(
                    filtersArray.length > 0
                        ? {
                              chats: filterChats(groupedChats.chats),
                              stickyChats: filterStickyChats(groupedChats.stickyChats),
                          }
                        : groupedChats
                )
            } catch (error) {
                if (!cancelled) {
                    console.error('Error loading unread chats for project:', projectId, error)
                    setUnreadChats(EMPTY_UNREAD_CHATS)
                }
            }
        }

        loadUnreadChats()

        return () => {
            cancelled = true
        }
    }, [projectId, chatsActiveTab, enabled, unreadChatIdsKey, JSON.stringify(filtersArray)])

    return unreadChats
}
