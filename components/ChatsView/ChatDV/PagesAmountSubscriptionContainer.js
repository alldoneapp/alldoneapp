import { useEffect } from 'react'
import { useDispatch } from 'react-redux'
import v4 from 'uuid/v4'

import { setChatPagesAmount } from '../../../redux/actions'
import { LIMIT_SHOW_EARLIER } from '../Utils/ChatHelper'
import { unwatchChatsMessagesAmount, watchChatsMessagesAmount } from '../../../utils/backends/Chats/chatNumbers'

export default function PagesAmountSubscriptionContainer({ projectId, chat }) {
    const dispatch = useDispatch()

    const updateData = amount => {
        const pagesAmount = Math.ceil(amount / LIMIT_SHOW_EARLIER)
        dispatch(setChatPagesAmount(pagesAmount))
    }

    useEffect(() => {
        const watcherKey = v4()
        watchChatsMessagesAmount(projectId, chat.type, chat.id, watcherKey, updateData)
        return () => {
            unwatchChatsMessagesAmount(watcherKey)
        }
    }, [projectId, chat.type, chat.id])

    return null
}
