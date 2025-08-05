import { useEffect, useState } from 'react'
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

    useEffect(() => {
        console.log(
            '🔄 useGetStickyChats: Starting loading data for project:',
            projectId,
            'tab:',
            chatsActiveTab,
            'toRender:',
            toRender,
            'filters:',
            filtersArray.length
        )
        dispatch(startLoadingData())
        let query = getDb().collection(`chatObjects/${projectId}/chats/`)
        query =
            chatsActiveTab === ALL_TAB
                ? query.where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, loggedUserId])
                : query.where('usersFollowing', 'array-contains', loggedUserId)
        const unsubscribe = query
            .where('stickyData.days', '>', 0)
            .orderBy('stickyData.days', 'asc')
            .limit(toRender)
            .onSnapshot(handleSnapshot, error => {
                console.error('❌ useGetStickyChats: Firebase snapshot error for project:', projectId, error)
                dispatch(stopLoadingData())
            })

        return () => {
            console.log('🧹 useGetStickyChats: Cleaning up listener for project:', projectId)
            unsubscribe()
        }
    }, [projectId, toRender, chatsActiveTab, JSON.stringify(filtersArray)])

    async function handleSnapshot(docs) {
        console.log('✅ useGetStickyChats: Received snapshot for project:', projectId, 'docs count:', docs.size)
        const chats = []
        docs.forEach(doc => {
            chats.push({ id: doc.id, ...doc.data() })
        })

        setChats(filtersArray.length > 0 ? filterStickyChats(chats) : chats)
        console.log('🛑 useGetStickyChats: Stopping loading data for project:', projectId)
        dispatch(stopLoadingData())
    }

    return chats
}
