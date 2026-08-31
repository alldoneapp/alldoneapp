import { useEffect, useState, useRef } from 'react'
import moment from 'moment'
import { useDispatch, useSelector } from 'react-redux'

import { startLoadingData, stopLoadingData } from '../../redux/actions'
import useSelectorHashtagFilters from '../../components/HashtagFilters/UseSelectorHashtagFilters'
import { filterChats } from '../../components/HashtagFilters/FilterHelpers/FilterChats'
import { getDb } from '../../utils/backends/firestore'
import { getChatAccessQueryArgs } from '../../utils/backends/Chats/chatAccessQuery'
import {
    buildSecondaryViewCacheKey,
    getSecondaryViewCacheEntry,
    getSecondaryViewCacheEntrySync,
    SECONDARY_VIEW_CHATS,
    setSecondaryViewCacheEntry,
} from '../../utils/InitialLoad/secondaryViewCache'

export const getChatsViewCacheKey = ({ projectId, chatsActiveTab, toRender, filtersArray, sticky = false }) =>
    buildSecondaryViewCacheKey(projectId, chatsActiveTab, toRender, filtersArray, sticky ? 'sticky' : 'regular')

export default function useGetChats(projectId, toRender, chatsActiveTab, cacheEnabled = true) {
    const dispatch = useDispatch()
    const { uid: loggedUserId, isAnonymous } = useSelector(state => state.loggedUser)
    const [, filtersArray] = useSelectorHashtagFilters()
    const filtersKey = JSON.stringify(filtersArray)
    const cacheKey = getChatsViewCacheKey({ projectId, chatsActiveTab, toRender, filtersArray })
    const initialCachedSnapshot = cacheEnabled
        ? getSecondaryViewCacheEntrySync(loggedUserId, SECONDARY_VIEW_CHATS, cacheKey)
        : null
    const [chats, setChats] = useState(() => initialCachedSnapshot?.chats || {})
    const isLoadingStartedRef = useRef(false)

    useEffect(() => {
        // Guard clause: Don't proceed if projectId is invalid
        if (!projectId || projectId === 'undefined' || projectId === 'null') {
            console.error('❌ useGetChats: Invalid projectId, skipping Firebase query:', projectId)
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
                !snapshot.chats
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
        query = query.where('stickyData.days', '==', 0).orderBy('lastEditionDate', 'desc').limit(toRender)
        const unsubscribe = query.onSnapshot(
            chatDocs => {
                liveSnapshotDelivered = true
                const chatsByDate = {}
                chatDocs.forEach(doc => {
                    const chat = { ...doc.data(), id: doc.id }
                    const date = moment(chat.lastEditionDate).format('YYYYMMDD')
                    if (!chatsByDate[date]) chatsByDate[date] = []
                    chatsByDate[date].push(chat)
                })

                const nextChats = filtersArray.length > 0 ? filterChats(chatsByDate) : chatsByDate
                setChats(nextChats)
                if (cacheEnabled) {
                    setSecondaryViewCacheEntry(loggedUserId, SECONDARY_VIEW_CHATS, cacheKey, {
                        projectId,
                        chatsActiveTab,
                        toRender,
                        filtersKey,
                        chats: nextChats,
                    })
                }
                if (isLoadingStartedRef.current) {
                    dispatch(stopLoadingData())
                    isLoadingStartedRef.current = false
                }
            },
            error => {
                console.error('❌ useGetChats: Firebase snapshot error for project:', projectId, error)
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
