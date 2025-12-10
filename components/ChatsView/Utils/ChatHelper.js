import moment from 'moment'

import store from '../../../redux/store'
import { ALL_TAB, FEED_PUBLIC_FOR_ALL } from '../../Feeds/Utils/FeedsConstants'
import {
    setSelectedNavItem,
    switchProject,
    storeCurrentUser,
    setSelectedTypeOfProject,
    setChatsActiveTab,
    setSelectedSidebarTab,
    navigateToAllProjectsTasks,
    navigateToAllProjectsChats,
} from '../../../redux/actions'
import ProjectHelper, { checkIfSelectedProject } from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { DV_TAB_CHAT_BOARD, DV_TAB_ROOT_CHATS } from '../../../utils/TabNavigationConstants'
import URLsChats, {
    URL_ALL_PROJECTS_CHATS_ALL,
    URL_ALL_PROJECTS_CHATS_FOLLOWED,
    URL_PROJECT_USER_CHATS_ALL,
    URL_PROJECT_USER_CHATS_FOLLOWED,
} from '../../../URLSystem/Chats/URLsChats'
import TasksHelper from '../../TaskListView/Utils/TasksHelper'
import Backend from '../../../utils/BackendBridge'
import { exitsOpenModals } from '../../ModalsManager/modalsManager'
import URLTrigger from '../../../URLSystem/URLTrigger'
import NavigationService from '../../../utils/NavigationService'
import { getDateFormat } from '../../UIComponents/FloatModals/DateFormatPickerModal'
import { translate } from '../../../i18n/TranslationService'
import { getChatMeta } from '../../../utils/backends/Chats/chatsFirestore'

class ChatHelper {
    static isPrivateChat = (chat, customUserId) => {
        const { loggedUser } = store.getState()
        const userId = customUserId ? customUserId : loggedUser.uid
        return (
            !chat ||
            loggedUser.isAnonymous ||
            (chat.isPublicFor && !chat.isPublicFor.includes(FEED_PUBLIC_FOR_ALL) && !chat.isPublicFor.includes(userId))
        )
    }

    static processURLAllTeamsChat = (navigation, tab = ALL_TAB) => {
        if (!store.getState().selectedSidebarTab) navigation.navigate('Root')
        store.dispatch(navigateToAllProjectsChats({ chatsActiveTab: tab }))
        URLsChats.replace(tab === ALL_TAB ? URL_ALL_PROJECTS_CHATS_ALL : URL_ALL_PROJECTS_CHATS_FOLLOWED, null)
    }

    static processURLProjectsUserChats = (navigation, projectId, userId, tab) => {
        const { loggedUserProjectsMap, loggedUser, selectedSidebarTab } = store.getState()

        const project = loggedUserProjectsMap[projectId]

        if (!selectedSidebarTab) {
            navigation.navigate('Root')
        }

        if (checkIfSelectedProject(project.index)) {
            const user = TasksHelper.getUserInProject(projectId, userId)
            const currentUser = user !== null ? user : loggedUser

            store.dispatch([
                switchProject(project.index),
                storeCurrentUser(currentUser),
                setSelectedSidebarTab(DV_TAB_ROOT_CHATS),
                setChatsActiveTab(tab),
            ])

            URLsChats.replace(
                tab === ALL_TAB ? URL_PROJECT_USER_CHATS_ALL : URL_PROJECT_USER_CHATS_FOLLOWED,
                null,
                projectId,
                loggedUser.uid
            )
        }
        // navigation.navigate('Root')
    }

    static processURLChatDetailsTab = async (navigation, tab, projectId, chatId) => {
        const { loggedUser } = store.getState()
        console.log('ChatHelper: Fetching chat metadata for', chatId, 'in project', projectId)
        const chat = await getChatMeta(projectId, chatId)
        console.log('ChatHelper: Chat metadata:', chat)

        const projectIndex = ProjectHelper.getProjectIndexById(projectId)
        console.log('ChatHelper: Project index:', projectIndex)

        const user = chat ? await Backend.getUserDataByUidOrEmail(chat.creatorId) : null
        console.log('ChatHelper: Chat creator data:', user)

        if (!chat) {
            console.log('ChatHelper: Navigation failed - Chat not found')
            navigation.navigate('Root')
            store.dispatch(navigateToAllProjectsTasks())
            return
        }

        if (!checkIfSelectedProject(projectIndex)) {
            console.log('ChatHelper: Navigation failed - Invalid project')
            navigation.navigate('Root')
            store.dispatch(navigateToAllProjectsTasks())
            return
        }

        if (!user) {
            console.log('ChatHelper: Chat creator found (probably assistant), using logged user')
            // Don't navigate away, just continue with logged user as fallback
        }

        const projectType = ProjectHelper.getTypeOfProject(loggedUser, projectId)
        let data = {
            chat,
            projectId,
        }
        console.log('ChatHelper: Navigating to chat view with data:', data)
        navigation.navigate('ChatDetailedView', data)

        store.dispatch([
            switchProject(projectIndex),
            storeCurrentUser(user || loggedUser),
            setSelectedNavItem(tab),
            setSelectedTypeOfProject(projectType),
        ])
    }
}

export const LIMIT_SHOW_EARLIER = 99

export const getLinkedParentChatUrl = (projectId, objectType, objectId) => {
    return `${window.location.origin}/projects/${projectId}/${
        objectType === 'topics' ? 'chats' : objectType
    }/${objectId}/chat`
}

export const isSomeChatEditOpen = () => {
    const edits = document.querySelectorAll('[data-edit-chat]')
    return edits.length > 0 || exitsOpenModals()
}

export const getChatIcon = chat => {
    switch (chat.type) {
        case 'tasks':
            return 'check-square'
        case 'goals':
            return 'target'
        case 'topics':
            return 'comments-thread'
        case 'notes':
            return 'file-text'
        case 'skills':
            return 'star'
        case 'assistants':
            return 'cpu'
    }
}

export const onOpenChat = (projectId, chat) => {
    console.log('ChatHelper: Opening chat:', { projectId, chat, chatType: chat.type })
    if (chat.type === 'topics') {
        console.log('ChatHelper: Direct navigation to ChatDetailedView')
        store.dispatch(setSelectedNavItem(DV_TAB_CHAT_BOARD))
        return NavigationService.navigate('ChatDetailedView', {
            projectId: projectId,
            chat,
        })
    } else {
        console.log('ChatHelper: URL-based navigation')
        const url = `/projects/${projectId}/${chat.type}/${chat.id}/chat`
        console.log('ChatHelper: Generated URL:', url)
        return URLTrigger.processUrl(NavigationService, url)
    }
}

export const getTimestampInMilliseconds = timestamp => {
    if (!timestamp && timestamp !== 0) return undefined
    if (typeof timestamp === 'number') return timestamp
    if (typeof timestamp === 'string') {
        const parsed = Date.parse(timestamp)
        return Number.isNaN(parsed) ? undefined : parsed
    }
    if (typeof timestamp?.seconds === 'number') return timestamp.seconds * 1000
    if (typeof timestamp?._seconds === 'number') return timestamp._seconds * 1000
    if (typeof timestamp?.toDate === 'function') {
        const date = timestamp.toDate()
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : undefined
    }
    return undefined
}

export const parseLastEdited = (serverTime, lastEdition) => {
    const tablet = store.getState().isMiddleScreen
    if (!Number.isFinite(lastEdition)) {
        return translate('Just now')
    }
    if (serverTime > lastEdition) {
        const today = moment(serverTime)
        const lastEdit = moment(lastEdition)
        const secondsDiff = today.diff(lastEdit, 'seconds')
        if (secondsDiff < 60) {
            if (secondsDiff === 1) {
                return translate(tablet ? '1 sec ago' : '1 second ago')
            }
            return `${secondsDiff} ${translate(tablet ? 'sec ago' : 'seconds ago')}`
        } else {
            const minutesDiff = today.diff(lastEdit, 'minutes')
            if (minutesDiff < 60) {
                if (minutesDiff === 1) {
                    return translate(tablet ? '1 min ago' : '1 minute ago')
                }
                return `${minutesDiff} ${translate(tablet ? 'min ago' : 'minutes ago')}`
            } else {
                const hoursDiff = today.diff(lastEdit, 'hours')
                if (hoursDiff < 24) {
                    if (hoursDiff === 1) {
                        return translate('1 hour ago')
                    }
                    return `${hoursDiff} ${translate('hours ago')}`
                } else {
                    return moment(lastEdition).format(getDateFormat())
                }
            }
        }
    }
}

export const checkIfThereAreNewComments = (projectChatNotifications, projectIds) => {
    for (let i = 0; i < projectIds.length; i++) {
        const projectId = projectIds[i]
        const projectData = projectChatNotifications[projectId]
        if (projectData?.totalFollowed > 0 || projectData?.totalUnfollowed > 0) return true
    }
    return false
}

export default ChatHelper
