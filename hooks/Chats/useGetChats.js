import { useEffect, useState } from 'react'
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

    useEffect(() => {
        dispatch(startLoadingData())
        let query = getDb().collection(`chatObjects/${projectId}/chats/`)
        query =
            chatsActiveTab === ALL_TAB
                ? query.where('isPublicFor', 'array-contains-any', [FEED_PUBLIC_FOR_ALL, loggedUserId])
                : query.where('usersFollowing', 'array-contains', loggedUserId)
        const unsubscribe = query
            .where('stickyData.days', '==', 0)
            .orderBy('lastEditionDate', 'desc')
            .limit(toRender)
            .onSnapshot(handleSnapshot)

        return () => {
            unsubscribe()
        }
    }, [projectId, toRender, chatsActiveTab, JSON.stringify(filtersArray)])

    async function handleSnapshot(chatDocs) {
        const chatsByDate = {}
        chatDocs.forEach(doc => {
            const chat = { ...doc.data(), id: doc.id }
            const date = moment(chat.lastEditionDate).format('YYYYMMDD')
            if (!chatsByDate[date]) chatsByDate[date] = []
            chatsByDate[date].push(chat)
        })

        setChats(filtersArray.length > 0 ? filterChats(chatsByDate) : chatsByDate)
        dispatch(stopLoadingData())
    }

    return chats
}
