import React from 'react'
import { useDispatch, useSelector } from 'react-redux'

import { dismissAllPopups } from '../../../../utils/HelperFunctions'
import { hideFloatPopup, hideWebSideBar, setChatsActiveTab, setSelectedSidebarTab } from '../../../../redux/actions'
import { DV_TAB_ROOT_CHATS } from '../../../../utils/TabNavigationConstants'
import store from '../../../../redux/store'
import { ALL_TAB, FOLLOWED_TAB } from '../../../Feeds/Utils/FeedsConstants'
import { translate } from '../../../../i18n/TranslationService'
import SectionItemLayoutHeader from '../SectionItemLayoutHeader'
import { getFollowedAndUnfollowedChatNotificationsAmount } from '../../../../utils/backends/Chats/chatsComments'

export default function Chats({ navigateToRoot, projectColor, selected, projectId, inAllProjects }) {
    const dispatch = useDispatch()

    const onPress = e => {
        e?.preventDefault()
        dismissAllPopups(true, true, true)

        const { projectChatNotifications, loggedUser, smallScreenNavigation } = store.getState()
        const { archivedProjectIds, templateProjectIds } = loggedUser

        const { totalFollowed, totalUnfollowed } = getFollowedAndUnfollowedChatNotificationsAmount(
            inAllProjects,
            projectId,
            projectChatNotifications,
            archivedProjectIds,
            templateProjectIds
        )

        const tab = totalFollowed || !totalUnfollowed ? FOLLOWED_TAB : ALL_TAB

        const actionsToDispatch = [setChatsActiveTab(tab), setSelectedSidebarTab(DV_TAB_ROOT_CHATS), hideFloatPopup()]

        if (smallScreenNavigation) actionsToDispatch.push(hideWebSideBar())

        navigateToRoot()
        dispatch(actionsToDispatch)
    }

    return (
        <SectionItemLayoutHeader
            icon={'comments-thread'}
            text={translate('Chats')}
            selected={selected}
            onPress={onPress}
            projectColor={projectColor}
            inChats={true}
            inAllProjects={inAllProjects}
            projectId={projectId}
        />
    )
}
