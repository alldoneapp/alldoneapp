import React from 'react'
import { StyleSheet, View } from 'react-native'
import PendingTasksByProject from './PendingTasksByProject'
import { useSelector } from 'react-redux'
import AllProjectsEmptyInbox from '../OpenTasksView/AllProjectsEmptyInbox'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import AssistantLine from '../../MyDayView/AssistantLine/AssistantLine'
import { checkIfThereAreNewComments } from '../../ChatsView/Utils/ChatHelper'
import AllProjectsLine from '../Header/AllProjectsLine/AllProjectsLine'

export default function PendingTasksViewAllProjects({ workflowTasksAmount }) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const archivedProjectIds = useSelector(state => state.loggedUser.archivedProjectIds)
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const loggedUser = useSelector(state => state.loggedUser)
    const projectChatNotifications = useSelector(state => state.projectChatNotifications)

    const projects = loggedUserProjects.filter(
        project => !templateProjectIds.includes(project.id) && !archivedProjectIds.includes(project.id)
    )

    const activeProjects = ProjectHelper.getActiveProjects2(projects, loggedUser)
    const guides = ProjectHelper.getGuideProjects(projects, loggedUser)

    const sortedProjects = [
        ...ProjectHelper.sortProjects(activeProjects, loggedUser.uid),
        ...ProjectHelper.sortProjects(guides, loggedUser.uid),
    ]
    const thereAreNewComments = checkIfThereAreNewComments(
        projectChatNotifications,
        sortedProjects.map(project => project.id)
    )

    const needToShowEmptyBoardPicture = workflowTasksAmount === 0

    return (
        <View>
            <View
                style={[
                    localStyles.container,
                    mobile ? localStyles.containerForMobile : isMiddleScreen && localStyles.containerForTablet,
                ]}
            >
                <AllProjectsLine />
                <AssistantLine />
                {sortedProjects.map(project => (
                    <PendingTasksByProject key={project.id} project={project} />
                ))}
            </View>
            {needToShowEmptyBoardPicture && !thereAreNewComments && <AllProjectsEmptyInbox />}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingHorizontal: 104,
        backgroundColor: 'white',
    },
    containerForMobile: {
        paddingHorizontal: 16,
    },
    containerForTablet: {
        paddingHorizontal: 56,
    },
})
