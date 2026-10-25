import { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'

import { subscribeWithLoading } from '../../utils/redux/loadingOperation'
import useSelectorHashtagFilters from '../../components/HashtagFilters/UseSelectorHashtagFilters'
import { filterStickyChats } from '../../components/HashtagFilters/FilterHelpers/FilterChats'
import { getDb } from '../../utils/backends/firestore'
import { getChatAccessQueryArgs } from '../../utils/backends/Chats/chatAccessQuery'
import { getChatsViewCacheKey } from './useGetChats'
import {
    getSecondaryViewCacheEntry,
    getSecondaryViewCacheEntrySync,
    SECONDARY_VIEW_CHATS,
    setSecondaryViewCacheEntry,
} from '../../utils/InitialLoad/secondaryViewCache'

export default function useGetStickyChats(projectId, toRender, chatsActiveTab, cacheEnabled = true) {
    const [, filtersArray] = useSelectorHashtagFilters()
    const { uid: loggedUserId, isAnonymous } = useSelector(state => state.loggedUser)
    const filtersKey = JSON.stringify(filtersArray)
    const cacheKey = getChatsViewCacheKey({ projectId, chatsActiveTab, toRender, filtersArray, sticky: true })
    const initialCachedSnapshot = cacheEnabled
        ? getSecondaryViewCacheEntrySync(loggedUserId, SECONDARY_VIEW_CHATS, cacheKey)
        : null
    const [chats, setChats] = useState(() => initialCachedSnapshot?.chats || [])

    useEffect(() => {
        // Guard clause: Don't proceed if projectId is invalid
        if (!projectId || projectId === 'undefined' || projectId === 'null') {
            console.error('❌ useGetStickyChats: Invalid projectId, skipping Firebase query:', projectId)
            return
        }

        let active = true
        let liveSnapshotDelivered = false
        const applyCachedSnapshot = snapshot => {
            if (
                !active ||
                liveSnapshotDelivered ||
                snapshot?.projectId !== projectId ||
                snapshot.chatsActiveTab !== chatsActiveTab ||
                snapshot.toRender !== toRender ||
                snapshot.filtersKey !== filtersKey ||
                !Array.isArray(snapshot.chats)
            ) {
                return
            }
            setChats(snapshot.chats)
        }
        const sessionSnapshot = cacheEnabled
            ? getSecondaryViewCacheEntrySync(loggedUserId, SECONDARY_VIEW_CHATS, cacheKey)
            : null
        if (cacheEnabled) {
            if (sessionSnapshot) applyCachedSnapshot(sessionSnapshot)
            else getSecondaryViewCacheEntry(loggedUserId, SECONDARY_VIEW_CHATS, cacheKey).then(applyCachedSnapshot)
        }

        const unsubscribe = subscribeWithLoading(
            'sticky_chats',
            (next, error) => {
                let query = getDb().collection(`chatObjects/${projectId}/chats/`)
                query = query.where(...getChatAccessQueryArgs({ activeTab: chatsActiveTab, loggedUserId, isAnonymous }))
                query = query.where('stickyData.days', '>', 0).orderBy('stickyData.days', 'asc').limit(toRender)
                return query.onSnapshot(next, error)
            },
            docs => {
                liveSnapshotDelivered = true
                const nextChats = []
                docs.forEach(doc => {
                    nextChats.push({ id: doc.id, ...doc.data() })
                })

                const filteredChats = filtersArray.length > 0 ? filterStickyChats(nextChats) : nextChats
                setChats(filteredChats)
                if (cacheEnabled) {
                    setSecondaryViewCacheEntry(loggedUserId, SECONDARY_VIEW_CHATS, cacheKey, {
                        projectId,
                        chatsActiveTab,
                        toRender,
                        filtersKey,
                        chats: filteredChats,
                    })
                }
            },
            {
                enabled: !sessionSnapshot,
                onError: error => {
                    console.error('❌ useGetStickyChats: Firebase snapshot error for project:', projectId, error)
                },
            }
        )

        return () => {
            active = false
            unsubscribe()
        }
    }, [projectId, toRender, chatsActiveTab, loggedUserId, isAnonymous, filtersKey, cacheKey, cacheEnabled])

    return chats
}
