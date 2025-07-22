import React from 'react'
import { orderBy, sortBy } from 'lodash'
import { useSelector } from 'react-redux'
import { StyleSheet, View } from 'react-native'
import DoneTasksByProject from './DoneTasksByProject'
import AllProjectsEmptyInbox from '../OpenTasksView/AllProjectsEmptyInbox'
import AssistantLine from '../../MyDayView/AssistantLine/AssistantLine'
import { checkIfThereAreNewComments } from '../../ChatsView/Utils/ChatHelper'
import AllProjectsLine from '../Header/AllProjectsLine/AllProjectsLine'

export default function DoneTasksViewAllProjects() {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const doneTasksAmount = useSelector(state => state.doneTasksAmount)
    const archivedProjectIds = useSelector(state => state.loggedUser.archivedProjectIds)
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const projectChatNotifications = useSelector(state => state.projectChatNotifications)

    const projects = loggedUserProjects.filter(
        project => !templateProjectIds.includes(project.id) && !archivedProjectIds.includes(project.id)
    )

    const normalProjects = projects.filter(project => !project.parentTemplateId)
    const guides = projects.filter(project => !!project.parentTemplateId)

    const sortedLoggedUserProjects = [
        ...orderBy(sortBy(normalProjects, [project => project.name.toLowerCase()]), 'lastDoneDate', 'desc'),
        ...orderBy(sortBy(guides, [project => project.name.toLowerCase()]), 'lastDoneDate', 'desc'),
    ]

    const thereAreNewComments = checkIfThereAreNewComments(
        projectChatNotifications,
        sortedLoggedUserProjects.map(project => project.id)
    )

    const needToShowEmptyBoardPicture = doneTasksAmount === 0

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
                {sortedLoggedUserProjects.map(project => (
                    <DoneTasksByProject key={project.id} project={project} />
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
