import { URL_NOT_MATCH } from '../URLSystemTrigger'
import {
    URL_ALL_PROJECTS_CHATS_ALL,
    URL_ALL_PROJECTS_CHATS_FOLLOWED,
    URL_PROJECT_USER_CHATS_ALL,
    URL_PROJECT_USER_CHATS_FOLLOWED,
    URL_CHAT_DETAILS,
    URL_CHAT_DETAILS_PROPERTIES,
    URL_CHAT_DETAILS_NOTE,
} from './URLsChats'
import { ALL_TAB, FOLLOWED_TAB } from '../../components/Feeds/Utils/FeedsConstants'
import ChatHelper from '../../components/ChatsView/Utils/ChatHelper'
import { DV_TAB_CHAT_BOARD, DV_TAB_CHAT_NOTE, DV_TAB_CHAT_PROPERTIES } from '../../utils/TabNavigationConstants'

class URLsChatsTrigger {
    static getRegexList = () => {
        return {
            [URL_ALL_PROJECTS_CHATS_FOLLOWED]: new RegExp('^/projects/chats/followed$'),
            [URL_ALL_PROJECTS_CHATS_ALL]: new RegExp('^/projects/chats/all$'),
            [URL_PROJECT_USER_CHATS_FOLLOWED]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w-]+)/chats/followed$'
            ),
            [URL_PROJECT_USER_CHATS_ALL]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w-]+)/chats/all$'
            ),
            [URL_CHAT_DETAILS]: new RegExp('^/projects/(?<projectId>[\\w-]+)/chats/(?<chatId>[\\w-]+)/chat$'),
            [URL_CHAT_DETAILS_PROPERTIES]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/chats/(?<chatId>[\\w-]+)/properties$'
            ),
            [URL_CHAT_DETAILS_NOTE]: new RegExp('^/projects/(?<projectId>[\\w-]+)/chats/(?<chatId>[\\w-]+)/note$'),
        }
    }

    static match = pathname => {
        const regexList = URLsChatsTrigger.getRegexList()

        for (let key in regexList) {
            const matchObj = pathname.match(regexList[key])

            if (matchObj) {
                return { key: key, matches: matchObj }
            }
        }

        return URL_NOT_MATCH
    }

    static trigger = (navigation, pathname) => {
        const matchedObj = URLsChatsTrigger.match(pathname)
        const params = matchedObj.matches.groups

        // This Switch will have CASEs as elements have the "regexList" const
        switch (matchedObj.key) {
            case URL_ALL_PROJECTS_CHATS_FOLLOWED:
                return ChatHelper.processURLAllTeamsChat(navigation, FOLLOWED_TAB)
            case URL_ALL_PROJECTS_CHATS_ALL:
                return ChatHelper.processURLAllTeamsChat(navigation, ALL_TAB)
            case URL_PROJECT_USER_CHATS_FOLLOWED:
                return ChatHelper.processURLProjectsUserChats(navigation, params.projectId, params.userId, FOLLOWED_TAB)
            case URL_PROJECT_USER_CHATS_ALL:
                return ChatHelper.processURLProjectsUserChats(navigation, params.projectId, params.userId, ALL_TAB)
            case URL_CHAT_DETAILS:
                return ChatHelper.processURLChatDetailsTab(
                    navigation,
                    DV_TAB_CHAT_BOARD,
                    params.projectId,
                    params.chatId
                )
            case URL_CHAT_DETAILS_PROPERTIES:
                return ChatHelper.processURLChatDetailsTab(
                    navigation,
                    DV_TAB_CHAT_PROPERTIES,
                    params.projectId,
                    params.chatId
                )
            case URL_CHAT_DETAILS_NOTE:
                return ChatHelper.processURLChatDetailsTab(
                    navigation,
                    DV_TAB_CHAT_NOTE,
                    params.projectId,
                    params.chatId
                )
        }
    }
}

export default URLsChatsTrigger
