import store from '../../../redux/store'
import { matchSearch } from '../HashtagFiltersHelper'

/**
 * Determine if a Chat match with the term list
 *
 * @param chat
 * @returns {boolean}
 */
export const chatMatchHashtagFilters = chat => {
    const termList = Array.from(store.getState().hashtagFilters.keys())
    return (
        termList.length === 0 ||
        matchSearch(chat.title, termList) ||
        matchSearch(chat.commentsData?.lastComment, termList)
    )
}

export const filterChats = chats => {
    const newFilteredChats = {}

    for (let dateIndex in chats) {
        const chatsF = chats[dateIndex].filter(chat => chatMatchHashtagFilters(chat))

        if (chatsF.length > 0) {
            newFilteredChats[dateIndex] = chatsF
        }
    }

    return newFilteredChats
}

export const filterStickyChats = chats => {
    return chats.filter(chat => chatMatchHashtagFilters(chat))
}
