import { useEffect, useState, useRef } from 'react'
import moment from 'moment'
import { useDispatch, useSelector } from 'react-redux'

import { startLoadingData, stopLoadingData } from '../../redux/actions'
import useSelectorHashtagFilters from '../../components/HashtagFilters/UseSelectorHashtagFilters'
import { filterChats } from '../../components/HashtagFilters/FilterHelpers/FilterChats'
import { getDb } from '../../utils/backends/firestore'
import { getChatAccessQueryArgs } from '../../utils/backends/Chats/chatAccessQuery'

export default function useGetChats(projectId, toRender, chatsActiveTab) {
    const dispatch = useDispatch()
    const { uid: loggedUserId, isAnonymous } = useSelector(state => state.loggedUser)
    const [chats, setChats] = useState({})
    const [filters, filtersArray] = useSelectorHashtagFilters()
    const isLoadingStartedRef = useRef(false)

    useEffect(() => {
        // Guard clause: Don't proceed if projectId is invalid
        if (!projectId || projectId === 'undefined' || projectId === 'null') {
            console.error('❌ useGetChats: Invalid projectId, skipping Firebase query:', projectId)
            return
        }

        dispatch(startLoadingData())
        isLoadingStartedRef.current = true
        let query = getDb().collection(`chatObjects/${projectId}/chats/`)
        query = query.where(...getChatAccessQueryArgs({ activeTab: chatsActiveTab, loggedUserId, isAnonymous }))
        query = query.where('stickyData.days', '==', 0).orderBy('lastEditionDate', 'desc').limit(toRender)
        const unsubscribe = query.onSnapshot(handleSnapshot, error => {
            console.error('❌ useGetChats: Firebase snapshot error for project:', projectId, error)
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
    }, [projectId, toRender, chatsActiveTab, loggedUserId, isAnonymous, JSON.stringify(filtersArray)])

    async function handleSnapshot(chatDocs) {
        const chatsByDate = {}
        chatDocs.forEach(doc => {
            const chat = { ...doc.data(), id: doc.id }
            const date = moment(chat.lastEditionDate).format('YYYYMMDD')
            if (!chatsByDate[date]) chatsByDate[date] = []
            chatsByDate[date].push(chat)
        })

        setChats(filtersArray.length > 0 ? filterChats(chatsByDate) : chatsByDate)
        if (isLoadingStartedRef.current) {
            dispatch(stopLoadingData())
            isLoadingStartedRef.current = false
        }
    }

    return chats
}
