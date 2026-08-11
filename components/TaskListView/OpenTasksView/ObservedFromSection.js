import React from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import Avatar from '../../Avatar'
import { OBSERVED_TASKS_INDEX, NOT_PARENT_GOAL_INDEX, sortGoalTasksGorups } from '../../../utils/backends/openTasks'
import TasksHelper from '../Utils/TasksHelper'
import {
    getWorkstreamInProject,
    setWorkstreamLastVisitedBoardDate,
    WORKSTREAM_ID_PREFIX,
} from '../../Workstreams/WorkstreamHelper'
import ParentGoalSection from './ParentGoalSection'
import TasksList from './TasksList'
import store from '../../../redux/store'
import { DV_TAB_ROOT_TASKS } from '../../../utils/TabNavigationConstants'
import {
    hideFloatPopup,
    hideGlobalSearchPopup,
    setGlobalSearchResults,
    setSearchText,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    setTaskViewToggleIndex,
    setTaskViewToggleSection,
    storeCurrentUser,
    switchProject,
} from '../../../redux/actions'
import ContactsHelper from '../../ContactsView/Utils/ContactsHelper'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import SocialText from '../../UIControls/SocialText/SocialText'
import { translate } from '../../../i18n/TranslationService'
import GeneralTasksHeader from './GeneralTasksHeader'
import SwipeableGeneralTasksHeader from './SwipeableGeneralTasksHeader'
import { GLOBAL_PROJECT_ID, getAssistant } from '../../AdminPanel/Assistants/assistantsHelper'
import { setAssistantLastVisitedBoardDate } from '../../../utils/backends/Assistants/assistantsFirestore'

export default function ObservedFromSection({
    projectId,
    assigneeId,
    dateIndex,
    nestedTaskListIndex,
    isActiveOrganizeMode,
    taskByGoalsList,
    instanceKey,
    projectIndex,
}) {
    const dispatch = useDispatch()
    const subtaskByTaskStore = useSelector(state => state.subtaskByTaskStore[instanceKey])
    const openMilestones = useSelector(state => state.openMilestonesByProjectInTasks[projectId])
    const doneMilestones = useSelector(state => state.doneMilestonesByProjectInTasks[projectId])
    const goalsById = useSelector(state => state.goalsByProjectInTasks[projectId])

    const subtaskByTask = subtaskByTaskStore ? subtaskByTaskStore : {}
    const owner =
        TasksHelper.getPeopleById(assigneeId, projectId) ||
        getWorkstreamInProject(projectId, assigneeId) ||
        getAssistant(assigneeId)

    const onPressHeader = e => {
        e?.preventDefault()
        const { loggedUser, currentUser, globalAssistants } = store.getState()
        let projectType = ProjectHelper.getTypeOfProject(loggedUser, projectId)

        const isAssistant = !!owner.temperature

        if (isAssistant) {
            const isGlobalAssistant = globalAssistants.find(item => item.uid === owner.uid)
            setAssistantLastVisitedBoardDate(
                isGlobalAssistant ? GLOBAL_PROJECT_ID : projectId,
                owner,
                projectId,
                'lastVisitBoard'
            )
        } else if (owner.uid.startsWith(WORKSTREAM_ID_PREFIX)) {
            setWorkstreamLastVisitedBoardDate(projectId, owner, 'lastVisitBoard')
        } else {
            ContactsHelper.setUserLastVisitedBoardDate(projectId, owner, 'lastVisitBoard')
        }

        let dispatches = [
            setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
            setTaskViewToggleIndex(isAssistant ? 1 : 0),
            setTaskViewToggleSection(isAssistant ? 'In progress' : 'Open'),
            storeCurrentUser(owner),
            setSelectedTypeOfProject(projectType),
            hideFloatPopup(),
            switchProject(projectIndex),
        ]

        if (currentUser.uid !== owner.uid) {
            dispatches = dispatches.concat([setSearchText(''), hideGlobalSearchPopup(), setGlobalSearchResults(null)])
        }

        dispatch(dispatches)
    }

    const goalsPositionId = sortGoalTasksGorups(
        projectId,
        openMilestones,
        doneMilestones,
        goalsById,
        assigneeId,
        taskByGoalsList
    )

    if (!goalsPositionId) return null

    const sortedObservedTasks = [...taskByGoalsList]
    sortedObservedTasks.sort((a, b) => goalsPositionId[a[0]] - goalsPositionId[b[0]])

    const showGneralTasksHeader = sortedObservedTasks.length > 0 && sortedObservedTasks[0][0] !== NOT_PARENT_GOAL_INDEX

    return owner ? (
        <View style={localStyles.container}>
            <View style={localStyles.subContainer}>
                <TouchableOpacity
                    onPress={onPressHeader}
                    style={localStyles.centeredRow}
                    disabled={owner.recorderUserId}
                    accessible={false}
                >
                    <Avatar avatarId={assigneeId} reviewerPhotoURL={owner.photoURL} borderSize={0} />
                    <View style={localStyles.textContainer}>
                        <SocialText
                            style={[styles.caption1, { color: colors.Text03 }]}
                            numberOfLines={1}
                            projectId={projectId}
                            inFeedComment={true}
                            showEllipsis={true}
                        >
                            {`${translate('Tasks assigned to')} ${owner.displayName}`}
                        </SocialText>
                    </View>
                </TouchableOpacity>
            </View>

            {sortedObservedTasks.map((goalTasksData, index) => {
                const goalId = goalTasksData[0]
                const taskList = goalTasksData[1]
                const isLastIndex = sortedObservedTasks.length - 1 === index
                const goalIndex = taskByGoalsList.findIndex(data => data[0] === goalId)
                return goalId === NOT_PARENT_GOAL_INDEX ? (
                    <View>
                        {showGneralTasksHeader && (
                            <SwipeableGeneralTasksHeader
                                projectId={projectId}
                                taskList={taskList}
                                dateIndex={dateIndex}
                                instanceKey={instanceKey}
                            />
                        )}
                        <TasksList
                            key={goalId}
                            projectId={projectId}
                            dateIndex={dateIndex}
                            subtaskByTask={subtaskByTask}
                            isActiveOrganizeMode={isActiveOrganizeMode}
                            taskList={taskList}
                            taskListIndex={OBSERVED_TASKS_INDEX}
                            isObservedTask={true}
                            goalIndex={goalIndex}
                            instanceKey={instanceKey}
                        />
                    </View>
                ) : (
                    <ParentGoalSection
                        key={goalId}
                        projectId={projectId}
                        dateIndex={dateIndex}
                        goalId={goalId}
                        subtaskByTask={subtaskByTask}
                        isActiveOrganizeMode={isActiveOrganizeMode}
                        taskList={taskList}
                        taskListIndex={OBSERVED_TASKS_INDEX}
                        containerStyle={isLastIndex ? null : { marginBottom: 16 }}
                        isObservedTask={true}
                        nestedTaskListIndex={nestedTaskListIndex}
                        goalIndex={goalIndex}
                        instanceKey={instanceKey}
                    />
                )
            })}
        </View>
    ) : null
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
    },
    subContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 48,
        marginTop: 32,
        paddingBottom: 2,
        paddingLeft: 2,
    },
    centeredRow: {
        flex: 1,
        maxHeight: 28,
        flexDirection: 'row',
        alignItems: 'center',
    },
    textContainer: {
        flex: 1,
        marginLeft: 8,
        overflow: 'hidden',
    },
})
