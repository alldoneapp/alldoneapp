import { useSelector } from 'react-redux'

import {
    DV_TAB_ROOT_CONTACTS,
    DV_TAB_ROOT_GOALS,
    DV_TAB_ROOT_NOTES,
    DV_TAB_ROOT_TASKS,
    DV_TAB_ROOT_UPDATES,
} from '../../utils/TabNavigationConstants'

export default function useShowNewCommentsBubbleInBoard(projectId) {
    const totalFollowed = useSelector(state => state.projectChatNotifications[projectId]?.totalFollowed ?? 0)
    const totalUnfollowed = useSelector(state => state.projectChatNotifications[projectId]?.totalUnfollowed ?? 0)
    const selectedSidebarTab = useSelector(state => state.selectedSidebarTab)

    const ROUTES__TO_SHOW_COMMENT_BUBBLES = [
        DV_TAB_ROOT_TASKS,
        DV_TAB_ROOT_NOTES,
        DV_TAB_ROOT_GOALS,
        DV_TAB_ROOT_CONTACTS,
        DV_TAB_ROOT_UPDATES,
    ]

    const getShowBubblesData = () => {
        const areFollowedComments = totalFollowed > 0
        const areUnfollowedComments = totalUnfollowed > 0
        if (areFollowedComments || areUnfollowedComments) {
            const routeAllowShowBubbles = ROUTES__TO_SHOW_COMMENT_BUBBLES.includes(selectedSidebarTab)
            return {
                showFollowedBubble: areFollowedComments && routeAllowShowBubbles,
                showUnfollowedBubble: areUnfollowedComments && routeAllowShowBubbles,
                totalFollowed,
                totalUnfollowed,
            }
        }
        return { showFollowedBubble: false, showUnfollowedBubble: false, totalFollowed, totalUnfollowed }
    }

    return getShowBubblesData()
}
