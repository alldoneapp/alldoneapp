import { useEffect, useState, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import { startLoadingData, stopLoadingData } from '../../redux/actions'
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
    const dispatch = useDispatch()
    const isLoadingStartedRef = useRef(false)

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
        if (!sessionSnapshot) {
            dispatch(startLoadingData())
            isLoadingStartedRef.current = true
        }

        let query = getDb().collection(`chatObjects/${projectId}/chats/`)
        query = query.where(...getChatAccessQueryArgs({ activeTab: chatsActiveTab, loggedUserId, isAnonymous }))
        query = query.where('stickyData.days', '>', 0).orderBy('stickyData.days', 'asc').limit(toRender)
        const unsubscribe = query.onSnapshot(
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
                if (isLoadingStartedRef.current) {
                    dispatch(stopLoadingData())
                    isLoadingStartedRef.current = false
                }
            },
            error => {
                console.error('❌ useGetStickyChats: Firebase snapshot error for project:', projectId, error)
                if (isLoadingStartedRef.current) {
                    dispatch(stopLoadingData())
                    isLoadingStartedRef.current = false
                }
            }
        )

        return () => {
            active = false
            if (isLoadingStartedRef.current) {
                dispatch(stopLoadingData())
                isLoadingStartedRef.current = false
            }
            unsubscribe()
        }
    }, [projectId, toRender, chatsActiveTab, loggedUserId, isAnonymous, filtersKey, cacheKey, cacheEnabled])

    return chats
}
