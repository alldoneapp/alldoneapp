import React from 'react'
import { useDispatch, useSelector } from 'react-redux'

import store from '../../../redux/store'
import NavigationService from '../../../utils/NavigationService'
import { DV_TAB_ROOT_CHATS, ROOT_ROUTES } from '../../../utils/TabNavigationConstants'
import { translate } from '../../../i18n/TranslationService'
import { getSidebarChatsActions } from '../openSidebarChats'
import SidebarLinkItem from './SidebarLinkItem'

// AT-3020 — the project's Chats in the simple sidebar, directly under the wiki. It opens the same
// list, on the same tab, as the "Chats" section of the advanced sidebar (`getSidebarChatsActions`).
// The simple sidebar only shows the selected project, so there is no project to switch to.
export default function ChatsItem({ projectId, projectColor }) {
    const dispatch = useDispatch()
    const selectedSidebarTab = useSelector(state => state.selectedSidebarTab)
    const route = useSelector(state => state.route)

    const highlight =
        route === 'ChatDetailedView' || (selectedSidebarTab === DV_TAB_ROOT_CHATS && route !== 'ProjectDetailedView')

    const onPress = e => {
        e?.preventDefault()
        const state = store.getState()
        if (!ROOT_ROUTES.includes(state.route)) NavigationService.navigate('Root')
        dispatch(getSidebarChatsActions(state, projectId))
    }

    return (
        <SidebarLinkItem
            icon={'comments-thread'}
            text={translate('Chats')}
            highlight={highlight}
            onPress={onPress}
            projectColor={projectColor}
            accessibilityLabel={'sidebar-chats-item'}
            nativeID={`sidebar-chats@${projectId}`}
        />
    )
}
