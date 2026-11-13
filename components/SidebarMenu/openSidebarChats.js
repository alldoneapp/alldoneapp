import { hideFloatPopup, hideWebSideBar, setChatsActiveTab, setSelectedSidebarTab } from '../../redux/actions'
import { DV_TAB_ROOT_CHATS } from '../../utils/TabNavigationConstants'
import { ALL_TAB, FOLLOWED_TAB } from '../Feeds/Utils/FeedsConstants'
import { getFollowedAndUnfollowedChatNotificationsAmount } from '../../utils/backends/Chats/chatsComments'

/**
 * The Chats list a sidebar entry opens, shared by the advanced sidebar's "Chats" section header and
 * the simple sidebar's "Chats" row under the wiki (AT-3020), so the two cannot drift apart.
 *
 * It opens on Followed while a followed chat has something unread, or while nothing is unread at
 * all; it opens on All only when the unread chats are all ones the user does not follow, so a
 * press always lands where the new comments are.
 */
export function getSidebarChatsTab(state, projectId, inAllProjects = false) {
    const { projectChatNotifications, loggedUser } = state
    const { archivedProjectIds, templateProjectIds } = loggedUser

    const { totalFollowed, totalUnfollowed } = getFollowedAndUnfollowedChatNotificationsAmount(
        inAllProjects,
        projectId,
        projectChatNotifications,
        archivedProjectIds,
        templateProjectIds
    )

    return totalFollowed || !totalUnfollowed ? FOLLOWED_TAB : ALL_TAB
}

export function getSidebarChatsActions(state, projectId, inAllProjects = false) {
    const actions = [
        setChatsActiveTab(getSidebarChatsTab(state, projectId, inAllProjects)),
        setSelectedSidebarTab(DV_TAB_ROOT_CHATS),
        hideFloatPopup(),
    ]
    if (state.smallScreenNavigation) actions.push(hideWebSideBar())
    return actions
}
