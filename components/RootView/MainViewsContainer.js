import React from 'react'
import { View, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'

import MainTasksView from '../TaskListView/MainTasksView'
import ContactsView from '../ContactsView/ContactsView'
import GoalsView from '../GoalsView/GoalsView'
import RootViewFeedsGlobalProject from '../Feeds/RootViewFeedsGlobalProject'
import NotesView from '../NotesView/NotesView'
import {
    DV_TAB_ROOT_CONTACTS,
    DV_TAB_ROOT_GOALS,
    DV_TAB_ROOT_NOTES,
    DV_TAB_ROOT_TASKS,
    DV_TAB_ROOT_UPDATES,
    DV_TAB_ROOT_CHATS,
} from '../../utils/TabNavigationConstants'
import ChatsView from '../ChatsView/ChatsView'
import CustomScrollView from '../UIControls/CustomScrollView'
import useCollapsibleSidebar from '../SidebarMenu/Collapsible/UseCollapsibleSidebar'
import { SIDEBAR_MENU_COLLAPSED_WIDTH } from '../styles/global'

export default function MainViewsContainer() {
    const selectedTab = useSelector(state => state.selectedSidebarTab)
    const enableScroll = useSelector(state => !(state.smallScreen && state.showFloatPopup > 0))
    //enableScroll will only work for touch scrolls events

    const { overlay } = useCollapsibleSidebar()

    return (
        <CustomScrollView
            style={[localStyles.subContainer, overlay && { marginLeft: SIDEBAR_MENU_COLLAPSED_WIDTH }]}
            scrollEnabled={enableScroll}
        >
            <View>
                {(() => {
                    switch (selectedTab) {
                        case DV_TAB_ROOT_TASKS:
                            return <MainTasksView />
                        case DV_TAB_ROOT_NOTES:
                            return <NotesView />
                        case DV_TAB_ROOT_GOALS:
                            return <GoalsView />
                        case DV_TAB_ROOT_CONTACTS:
                            return <ContactsView />
                        case DV_TAB_ROOT_CHATS:
                            return <ChatsView />
                        case DV_TAB_ROOT_UPDATES:
                            return <RootViewFeedsGlobalProject />
                    }
                })()}
            </View>
        </CustomScrollView>
    )
}

const localStyles = StyleSheet.create({
    subContainer: {
        flex: 1,
    },
})
