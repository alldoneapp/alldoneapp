import React, { useState, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import OpenTasksByProject from './OpenTasksByProject'
import { resetLoadingData, setLaterTasksExpanded, setSomedayTasksExpanded } from '../../../redux/actions'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import AssistantLine from '../../MyDayView/AssistantLine/AssistantLine'
import AllProjectsEmptyInbox from './AllProjectsEmptyInbox'
import AllProjectsShowMoreButtonContainer from './AllProjectsShowMoreButtonContainer'
import { checkIfThereAreNewComments } from '../../ChatsView/Utils/ChatHelper'
import AllProjectsLine from '../Header/AllProjectsLine/AllProjectsLine'

export default function OpenTasksViewAllProjects() {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds)
    const archivedProjectIds = useSelector(state => state.loggedUser.archivedProjectIds)
    const guideProjectIds = useSelector(state => state.loggedUser.guideProjectIds)
    const projectIds = useSelector(state => state.loggedUser.projectIds)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const openTasksAmount = useSelector(state => state.openTasksAmount)
    const todayEmptyGoalsTotal = useSelector(state => state.todayEmptyGoalsTotalAmountInOpenTasksView.total)
    const inFocusTaskProjectId = useSelector(state => state.loggedUser.inFocusTaskProjectId)
    const loggedUserProjectsMap = useSelector(state => state.loggedUserProjectsMap)
    const projectChatNotifications = useSelector(state => state.projectChatNotifications)
    const [projectsHaveTasksInFirstDay, setProjectsHaveTasksInFirstDay] = useState({})

    const sortedLoggedUserProjectIds = ProjectHelper.getNormalAndGuideProjectsSortedBySortedAndWithProjectInFocusAtTheTop(
        projectIds,
        guideProjectIds,
        archivedProjectIds,
        templateProjectIds,
        loggedUserProjectsMap,
        loggedUserId,
        inFocusTaskProjectId
    )

    const thereAreNewComments = checkIfThereAreNewComments(projectChatNotifications, sortedLoggedUserProjectIds)

    useEffect(() => {
        dispatch(resetLoadingData())
        return () => {
            dispatch(resetLoadingData())
        }
    }, [])

    useEffect(() => {
        return () => {
            dispatch([setLaterTasksExpanded(false), setSomedayTasksExpanded(false)])
        }
    }, [])

    let areFirstProject = false

    const needToShowEmptyBoardPicture = !openTasksAmount && !todayEmptyGoalsTotal && !thereAreNewComments

    return (
        <View
            style={[
                localStyles.container,
                smallScreenNavigation
                    ? localStyles.containerForMobile
                    : isMiddleScreen && localStyles.containerForTablet,
            ]}
        >
            <AllProjectsLine />
            <AssistantLine />
            {needToShowEmptyBoardPicture && <AllProjectsEmptyInbox />}
            {sortedLoggedUserProjectIds.map(projectId => {
                let thisProjectIsTheFirstProject = false
                if (projectsHaveTasksInFirstDay[projectId] && !areFirstProject) {
                    areFirstProject = true
                    thisProjectIsTheFirstProject = true
                }

                return (
                    <OpenTasksByProject
                        key={projectId}
                        projectId={projectId}
                        firstProject={thisProjectIsTheFirstProject}
                        sortedLoggedUserProjectIds={sortedLoggedUserProjectIds}
                        setProjectsHaveTasksInFirstDay={setProjectsHaveTasksInFirstDay}
                    />
                )
            })}

            <AllProjectsShowMoreButtonContainer
                projectIds={sortedLoggedUserProjectIds}
                setProjectsHaveTasksInFirstDay={setProjectsHaveTasksInFirstDay}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingHorizontal: 104,
        backgroundColor: 'white',
        marginBottom: 32,
    },
    containerForMobile: {
        paddingHorizontal: 16,
    },
    containerForTablet: {
        paddingHorizontal: 56,
    },
})
