import { useEffect, useState, useRef } from 'react'
import moment from 'moment'
import { useDispatch, useSelector } from 'react-redux'

import { startLoadingData, stopLoadingData } from '../../redux/actions'
import { ALL_TAB, FEED_PUBLIC_FOR_ALL } from '../../components/Feeds/Utils/FeedsConstants'
import useSelectorHashtagFilters from '../../components/HashtagFilters/UseSelectorHashtagFilters'
import { filterChats } from '../../components/HashtagFilters/FilterHelpers/FilterChats'
import { getDb } from '../../utils/backends/firestore'

export default function useGetChats(projectId, toRender, chatsActiveTab) {
    const dispatch = useDispatch()
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const [chats, setChats] = useState({})
    const [filters, filtersArray] = useSelectorHashtagFilters()
    const isLoadingStartedRef = useRef(false)

    useEffect(() => {
        console.log(
            '🔄 useGetChats: Starting loading data for project:',
            projectId,
            'tab:',
            chatsActiveTab,
            'toRender:',
            toRender,
            'filters:',
            filtersArray.length
        )

        // Guard clause: Don't proceed if projectId is invalid
        if (!projectId || projectId === 'undefined' || projectId === 'null') {
            console.error('❌ useGetChats: Invalid projectId, skipping Firebase query:', projectId)
            return
        }

        dispatch(startLoadingData())
        isLoadingStartedRef.current = true
        let query = getDb().collection(`chatObjects/${projectId}/chats/`)
        query =
            chatsActiveTab === ALL_TAB
                ? query.where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, loggedUserId])
                : query.where('usersFollowing', 'array-contains', loggedUserId)
        const unsubscribe = query
            .where('stickyData.days', '==', 0)
            .orderBy('created', 'desc')
            .limit(toRender)
            .onSnapshot(handleSnapshot, error => {
                console.error('❌ useGetChats: Firebase snapshot error for project:', projectId, error)
                if (isLoadingStartedRef.current) {
                    dispatch(stopLoadingData())
                    isLoadingStartedRef.current = false
                }
            })

        return () => {
            console.log('🧹 useGetChats: Cleaning up listener for project:', projectId)
            if (isLoadingStartedRef.current) {
                console.log('🔧 useGetChats: Stopping loading data on cleanup for project:', projectId)
                dispatch(stopLoadingData())
                isLoadingStartedRef.current = false
            }
            unsubscribe()
        }
    }, [projectId, toRender, chatsActiveTab, JSON.stringify(filtersArray)])

    async function handleSnapshot(chatDocs) {
        console.log('✅ useGetChats: Received snapshot for project:', projectId, 'docs count:', chatDocs.size)
        const chatsByDate = {}
        chatDocs.forEach(doc => {
            const chat = { ...doc.data(), id: doc.id }
            const date = moment(chat.created).format('YYYYMMDD')
            if (!chatsByDate[date]) chatsByDate[date] = []
            chatsByDate[date].push(chat)
        })

        setChats(filtersArray.length > 0 ? filterChats(chatsByDate) : chatsByDate)
        if (isLoadingStartedRef.current) {
            console.log('🛑 useGetChats: Stopping loading data for project:', projectId)
            dispatch(stopLoadingData())
            isLoadingStartedRef.current = false
        } else {
            console.warn('⚠️ useGetChats: Tried to stop loading when not started for project:', projectId)
        }
    }

    return chats
}
