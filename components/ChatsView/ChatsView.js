import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import {
    ALL_PROJECTS_INDEX,
    checkIfSelectedAllProjects,
    checkIfSelectedProject,
} from '../SettingsView/ProjectsSettings/ProjectHelper'
import ChatsHeader from './ChatsHeader'
import { useDispatch, useSelector } from 'react-redux'
import { DV_TAB_ROOT_CHATS } from '../../utils/TabNavigationConstants'
import { ALL_TAB } from '../Feeds/Utils/FeedsConstants'
import { setNavigationRoute } from '../../redux/actions'
import URLsChats, {
    URL_ALL_PROJECTS_CHATS_ALL,
    URL_ALL_PROJECTS_CHATS_FOLLOWED,
    URL_PROJECT_USER_CHATS_ALL,
    URL_PROJECT_USER_CHATS_FOLLOWED,
} from '../../URLSystem/Chats/URLsChats'
import ChatsByProject from './ChatsByProject'
import { sortBy } from 'lodash'
import HashtagFiltersView from '../HashtagFilters/HashtagFiltersView'
import NothingToShowOnChats from '../UIComponents/NothingToShowOnChats'
import ChatsSwitchableTagContainer from './ChatsSwitchableTag/ChatsSwitchableTagContainer'

function ChatsView() {
    const dispatch = useDispatch()
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const archivedProjectIds = useSelector(state => state.loggedUser.archivedProjectIds)
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds)
    const chatsActiveTab = useSelector(state => state.chatsActiveTab)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)

    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)
    const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)

    const project = inAllProjects ? ALL_PROJECTS_INDEX : loggedUserProjects[selectedProjectIndex]

    const projects = loggedUserProjects.filter(
        project => !templateProjectIds.includes(project.id) && !archivedProjectIds.includes(project.id)
    )

    const normalProjects = projects.filter(project => !project.parentTemplateId)
    const guides = projects.filter(project => !!project.parentTemplateId)

    const sortedProjects = [
        ...sortBy(normalProjects, [item => -item.lastChatActionDate]),
        ...sortBy(guides, [item => -item.lastChatActionDate]),
    ]

    const [areThereChats, setAreThereChats] = useState({})

    const writeBrowserURL = () => {
        if (inSelectedProject) {
            URLsChats.push(
                chatsActiveTab === ALL_TAB ? URL_PROJECT_USER_CHATS_ALL : URL_PROJECT_USER_CHATS_FOLLOWED,
                null,
                loggedUserProjects[selectedProjectIndex].id,
                loggedUserId
            )
        } else {
            URLsChats.push(
                chatsActiveTab === ALL_TAB ? URL_ALL_PROJECTS_CHATS_ALL : URL_ALL_PROJECTS_CHATS_FOLLOWED,
                null
            )
        }
    }

    useEffect(() => {
        dispatch(setNavigationRoute(DV_TAB_ROOT_CHATS))
    }, [])

    useEffect(() => {
        writeBrowserURL()
    }, [chatsActiveTab, selectedProjectIndex])

    return (
        <View
            style={[
                localStyles.container,
                inAllProjects && localStyles.containerSpace,
                smallScreenNavigation ? localStyles.containerMobile : isMiddleScreen && localStyles.containerTablet,
            ]}
        >
            <ChatsHeader projectId={project?.id} userId={loggedUserId} />

            <ChatsSwitchableTagContainer />

            <HashtagFiltersView />

            {inSelectedProject ? (
                <ChatsByProject
                    project={loggedUserProjects[selectedProjectIndex]}
                    chatXProject={areThereChats}
                    setChatXProject={setAreThereChats}
                />
            ) : (
                <>
                    {!Object.values(areThereChats).includes(true) && <NothingToShowOnChats isInChats />}
                    {sortedProjects.map(project => (
                        <ChatsByProject
                            key={project.id}
                            project={project}
                            isInAllProjects
                            chatXProject={areThereChats}
                            setChatXProject={setAreThereChats}
                        />
                    ))}
                </>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginHorizontal: 104,
    },
    containerSpace: {
        marginBottom: 32,
    },
    containerMobile: {
        marginHorizontal: 16,
    },
    containerTablet: {
        marginHorizontal: 56,
    },
})

export default ChatsView
