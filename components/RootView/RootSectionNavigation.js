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
import { useArtifactsActiveTab } from '../ArtifactsView/artifactsNavigationState'
import URLsArtifacts, {
    URL_ALL_PROJECTS_ARTIFACTS_ALL,
    URL_ALL_PROJECTS_ARTIFACTS_FOLLOWED,
} from '../../URLSystem/Artifacts/URLsArtifacts'
import { checkIfSelectedAllProjects } from '../SettingsView/ProjectsSettings/ProjectHelper'
import {
    DV_TAB_ROOT_ARTIFACTS,
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

function ArtifactsSectionToggle() {
    const [artifactsActiveTab, setArtifactsActiveTab] = useArtifactsActiveTab()
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)

    return (
        <MultiToggleSwitch
            options={[
                { icon: 'eye', text: 'Followed', badge: null },
                { icon: 'package', text: 'All', badge: null },
            ]}
            currentIndex={artifactsActiveTab === ALL_TAB ? 1 : 0}
            onChangeOption={index => {
                const tab = index === 0 ? FOLLOWED_TAB : ALL_TAB
                setArtifactsActiveTab(tab)
                if (checkIfSelectedAllProjects(selectedProjectIndex)) {
                    URLsArtifacts.push(
                        tab === ALL_TAB ? URL_ALL_PROJECTS_ARTIFACTS_ALL : URL_ALL_PROJECTS_ARTIFACTS_FOLLOWED
                    )
                }
            }}
        />
    )
}

export default function RootSectionNavigation({ useOuterMargins = true }) {
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
            case DV_TAB_ROOT_ARTIFACTS:
                return <ArtifactsSectionToggle />
            default:
                return null
        }
    }

    if (
        ![
            DV_TAB_ROOT_TASKS,
            DV_TAB_ROOT_GOALS,
            DV_TAB_ROOT_NOTES,
            DV_TAB_ROOT_CONTACTS,
            DV_TAB_ROOT_CHATS,
            DV_TAB_ROOT_ARTIFACTS,
        ].includes(selectedTab)
    ) {
        return null
    }

    return (
        <View
            style={[
                useOuterMargins ? localStyles.container : localStyles.containerInProject,
                useOuterMargins &&
                    (smallScreenNavigation
                        ? localStyles.containerMobile
                        : isMiddleScreen && localStyles.containerTablet),
            ]}
        >
            <MainSectionTabsHeader showSectionToggle={true} renderSectionToggle={renderSectionToggle} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    containerInProject: {
        paddingHorizontal: 8,
    },
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
