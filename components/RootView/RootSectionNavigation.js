import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import MainSectionTabsHeader from '../TaskListView/Header/MainSectionTabsHeader'
import TasksMultiToggleSwitch from '../TaskListView/TasksMultiToggleSwitch'
import GoalsMultiToggleSwitch from '../GoalsView/GoalsMultiToggleSwitch'
import MultiToggleSwitch from '../UIControls/MultiToggleSwitch/MultiToggleSwitch'
import ChatsSwitchableTagContainer from '../ChatsView/ChatsSwitchableTag/ChatsSwitchableTagContainer'
import { ALL_TAB, FOLLOWED_TAB } from '../Feeds/Utils/FeedsConstants'
import { updateContactsActiveTab, updateNotesActiveTab } from '../../redux/actions'
import {
    DV_TAB_ROOT_CHATS,
    DV_TAB_ROOT_CONTACTS,
    DV_TAB_ROOT_GOALS,
    DV_TAB_ROOT_NOTES,
    DV_TAB_ROOT_TASKS,
} from '../../utils/TabNavigationConstants'

function NotesSectionToggle() {
    const dispatch = useDispatch()
    const notesActiveTab = useSelector(state => state.notesActiveTab)

    return (
        <MultiToggleSwitch
            options={[
                { icon: 'eye', text: 'Followed', badge: null },
                { icon: 'several-file-text', text: 'All', badge: null },
            ]}
            currentIndex={notesActiveTab}
            onChangeOption={index => dispatch(updateNotesActiveTab(index))}
        />
    )
}

function ContactsSectionToggle() {
    const dispatch = useDispatch()
    const contactsActiveTab = useSelector(state => state.contactsActiveTab)

    return (
        <MultiToggleSwitch
            options={[
                { icon: 'eye', text: 'Followed', badge: null },
                { icon: 'users', text: 'All', badge: null },
            ]}
            currentIndex={contactsActiveTab}
            onChangeOption={index => dispatch(updateContactsActiveTab(index === 0 ? FOLLOWED_TAB : ALL_TAB))}
        />
    )
}

export default function RootSectionNavigation() {
    const selectedTab = useSelector(state => state.selectedSidebarTab)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)

    const renderSectionToggle = () => {
        switch (selectedTab) {
            case DV_TAB_ROOT_TASKS:
                return <TasksMultiToggleSwitch />
            case DV_TAB_ROOT_GOALS:
                return <GoalsMultiToggleSwitch />
            case DV_TAB_ROOT_NOTES:
                return <NotesSectionToggle />
            case DV_TAB_ROOT_CONTACTS:
                return <ContactsSectionToggle />
            case DV_TAB_ROOT_CHATS:
                return <ChatsSwitchableTagContainer />
            default:
                return null
        }
    }

    if (
        ![DV_TAB_ROOT_TASKS, DV_TAB_ROOT_GOALS, DV_TAB_ROOT_NOTES, DV_TAB_ROOT_CONTACTS, DV_TAB_ROOT_CHATS].includes(
            selectedTab
        )
    ) {
        return null
    }

    return (
        <View
            style={[
                localStyles.container,
                smallScreenNavigation ? localStyles.containerMobile : isMiddleScreen && localStyles.containerTablet,
            ]}
        >
            <MainSectionTabsHeader showSectionToggle={true} renderSectionToggle={renderSectionToggle} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginHorizontal: 104,
    },
    containerMobile: {
        marginHorizontal: 16,
    },
    containerTablet: {
        marginHorizontal: 56,
    },
})
