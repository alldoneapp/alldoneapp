import { useEffect, useState, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import { startLoadingData, stopLoadingData } from '../../redux/actions'
import { ALL_TAB, FEED_PUBLIC_FOR_ALL } from '../../components/Feeds/Utils/FeedsConstants'
import useSelectorHashtagFilters from '../../components/HashtagFilters/UseSelectorHashtagFilters'
import { filterStickyChats } from '../../components/HashtagFilters/FilterHelpers/FilterChats'
import { getDb } from '../../utils/backends/firestore'

export default function useGetStickyChats(projectId, toRender, chatsActiveTab) {
    const [filters, filtersArray] = useSelectorHashtagFilters()
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const [chats, setChats] = useState([])
    const dispatch = useDispatch()
    const isLoadingStartedRef = useRef(false)

    useEffect(() => {
        // Guard clause: Don't proceed if projectId is invalid
        if (!projectId || projectId === 'undefined' || projectId === 'null') {
            console.error('❌ useGetStickyChats: Invalid projectId, skipping Firebase query:', projectId)
            return
        }

        dispatch(startLoadingData())
        isLoadingStartedRef.current = true
        let query = getDb().collection(`chatObjects/${projectId}/chats/`)
        query =
            chatsActiveTab === ALL_TAB
                ? query.where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, loggedUserId])
                : query.where('usersFollowing', 'array-contains', loggedUserId)
        query = query.where('stickyData.days', '>', 0).orderBy('stickyData.days', 'asc').limit(toRender)
        const unsubscribe = query.onSnapshot(handleSnapshot, error => {
            console.error('❌ useGetStickyChats: Firebase snapshot error for project:', projectId, error)
            if (isLoadingStartedRef.current) {
                dispatch(stopLoadingData())
                isLoadingStartedRef.current = false
            }
        })

        return () => {
            if (isLoadingStartedRef.current) {
                dispatch(stopLoadingData())
                isLoadingStartedRef.current = false
            }
            unsubscribe()
        }
    }, [projectId, toRender, chatsActiveTab, JSON.stringify(filtersArray)])

    async function handleSnapshot(docs) {
        const chats = []
        docs.forEach(doc => {
            chats.push({ id: doc.id, ...doc.data() })
        })

        setChats(filtersArray.length > 0 ? filterStickyChats(chats) : chats)
        if (isLoadingStartedRef.current) {
            dispatch(stopLoadingData())
            isLoadingStartedRef.current = false
        }
    }

    return chats
}
