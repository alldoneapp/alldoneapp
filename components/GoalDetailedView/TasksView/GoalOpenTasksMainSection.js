import React, { useState, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import GoalTasksList from './GoalTasksList'
import { MAIN_TASK_INDEX } from '../../../utils/backends/Tasks/openGoalTasks'
import ShowMoreButton from '../../UIControls/ShowMoreButton'
import SortModeActiveInfo from '../../GoalsView/SortModeActiveInfo'
import GoalNewTaskSection from './GoalNewTaskSection'
import SharedHelper from '../../../utils/SharedHelper'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { setGoalOpenMainTasksExpanded } from '../../../redux/actions'

export default function GoalOpenTasksMainSection({
    dateFormated,
    mainTasks,
    projectId,
    dateIndex,
    isActiveOrganizeMode,
    goal,
}) {
    const dispatch = useDispatch()
    const numberTodayTasks = useSelector(state => state.loggedUser.numberTodayTasks)
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const projectIds = useSelector(state => state.loggedUser.projectIds)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const goalOpenMainTasksExpanded = useSelector(state => state.goalOpenMainTasksExpanded)

    const showMainListShowMore =
        !isActiveOrganizeMode && dateIndex === 0 && numberTodayTasks > 0 && numberTodayTasks < mainTasks.length

    const contractTasks = () => {
        dispatch(setGoalOpenMainTasksExpanded(false))
    }

    const expandTasks = () => {
        dispatch(setGoalOpenMainTasksExpanded(true))
    }

    useEffect(() => {
        if (dateIndex === 0) {
            return () => {
                dispatch(setGoalOpenMainTasksExpanded(true))
            }
        }
    }, [dateIndex])

    const mainTasksToShow =
        goalOpenMainTasksExpanded || !showMainListShowMore ? mainTasks : mainTasks.slice(0, numberTodayTasks)

    const isTemplateProject = templateProjectIds.includes(projectId)
    const accessGranted = SharedHelper.checkIfUserHasAccessToProject(isAnonymous, projectIds, projectId, false)

    const loggedUserCanUpdateObject =
        loggedUserId.uid === goal.ownerId || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    return (
        <View style={localStyles.container}>
            {accessGranted &&
                loggedUserCanUpdateObject &&
                !isTemplateProject &&
                (isActiveOrganizeMode ? (
                    <SortModeActiveInfo containerStyle={{ paddingLeft: 8 }} />
                ) : (
                    <GoalNewTaskSection projectId={projectId} goal={goal} dateFormated={dateFormated} />
                ))}
            <GoalTasksList
                projectId={projectId}
                taskList={mainTasksToShow}
                dateIndex={dateIndex}
                taskListIndex={MAIN_TASK_INDEX}
                isActiveOrganizeMode={isActiveOrganizeMode}
            />
            {accessGranted &&
                loggedUserCanUpdateObject &&
                isTemplateProject &&
                (isActiveOrganizeMode ? (
                    <SortModeActiveInfo containerStyle={{ paddingLeft: 8 }} />
                ) : (
                    <GoalNewTaskSection projectId={projectId} goal={goal} dateFormated={dateFormated} />
                ))}
            {showMainListShowMore && (
                <ShowMoreButton
                    expanded={goalOpenMainTasksExpanded}
                    contract={contractTasks}
                    expand={expandTasks}
                    style={{ marginBottom: 0 }}
                />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
    },
})
