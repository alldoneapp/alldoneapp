import React, { useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import TasksHelper from '../Utils/TasksHelper'
import {
    DEFAULT_WORKSTREAM_ID,
    getWorkstreamInProject,
    setWorkstreamLastVisitedBoardDate,
    WORKSTREAM_ID_PREFIX,
} from '../../Workstreams/WorkstreamHelper'
import store from '../../../redux/store'
import { PROJECT_TYPE_ACTIVE } from '../../SettingsView/ProjectsSettings/ProjectsSettings'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import ContactsHelper from '../../ContactsView/Utils/ContactsHelper'
import {
    hideGlobalSearchPopup,
    setGlobalSearchResults,
    setSearchText,
    setSelectedTypeOfProject,
    setShowMoreInMainSection,
    setTaskViewToggleIndex,
    setTaskViewToggleSection,
    storeCurrentUser,
    hideFloatPopup,
    switchProject,
    setSelectedSidebarTab,
} from '../../../redux/actions'
import { DV_TAB_ROOT_TASKS } from '../../../utils/TabNavigationConstants'
import Avatar from '../../Avatar'
import styles, { colors } from '../../styles/global'
import {
    NOT_PARENT_GOAL_INDEX,
    sortGoalTasksGorups,
    STREAM_AND_USER_TASKS_INDEX,
} from '../../../utils/backends/openTasks'
import TasksList from './TasksList'
import ParentGoalSection from './ParentGoalSection'
import ShowMoreButton from '../../UIControls/ShowMoreButton'
import { translate } from '../../../i18n/TranslationService'
import GeneralTasksHeader from './GeneralTasksHeader'
import SwipeableGeneralTasksHeader from './SwipeableGeneralTasksHeader'

export default function StreamAndUserTasksSection({
    projectId,
    assigneeId,
    dateIndex,
    instanceKey,
    nestedTaskListIndex,
    isActiveOrganizeMode,
    taskByGoalsList,
    projectIndex,
}) {
    const { numberTodayTasks } = useSelector(state => state.loggedUser)
    const subtaskByTaskStore = useSelector(state => state.subtaskByTaskStore[instanceKey])
    const openMilestones = useSelector(state => state.openMilestonesByProjectInTasks[projectId])
    const doneMilestones = useSelector(state => state.doneMilestonesByProjectInTasks[projectId])
    const goalsById = useSelector(state => state.goalsByProjectInTasks[projectId])
    const [needShowMoreBtn, setNeedShowMoreBtn] = useState(false)

    let showMoreBtn = useRef(false).current
    let totalAmountTasks = useRef(0).current
    const dispatch = useDispatch()
    const owner = TasksHelper.getPeopleById(assigneeId, projectId) || getWorkstreamInProject(projectId, assigneeId)

    const subtaskByTask = subtaskByTaskStore ? subtaskByTaskStore : {}

    useEffect(() => {
        setNeedShowMoreBtn(showMoreBtn)
    }, [showMoreBtn])

    const expandTasks = () => {
        dispatch(setShowMoreInMainSection(assigneeId))
        onPressHeader()
    }

    const onPressHeader = e => {
        e?.preventDefault()
        const { loggedUser, currentUser } = store.getState()
        let projectType = PROJECT_TYPE_ACTIVE

        if (owner.uid.startsWith(WORKSTREAM_ID_PREFIX)) {
            setWorkstreamLastVisitedBoardDate(projectId, owner, 'lastVisitBoard')
        } else {
            projectType = ProjectHelper.getTypeOfProject(loggedUser, projectId)
            ContactsHelper.setUserLastVisitedBoardDate(projectId, owner, 'lastVisitBoard')
        }

        let dispatches = [
            setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
            setTaskViewToggleIndex(0),
            setTaskViewToggleSection('Open'),
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

    const sortedWorkstreamAndUserTasks = [...taskByGoalsList]
    sortedWorkstreamAndUserTasks.sort((a, b) => goalsPositionId[a[0]] - goalsPositionId[b[0]])

    const showGneralTasksHeader =
        sortedWorkstreamAndUserTasks.length > 0 && sortedWorkstreamAndUserTasks[0][0] !== NOT_PARENT_GOAL_INDEX

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
                    <View style={{ marginLeft: 8 }}>
                        <Text style={[styles.caption1, { color: colors.Text03 }]} numberOfLines={1}>{`${translate(
                            'Tasks assigned to'
                        )} ${
                            owner.uid === DEFAULT_WORKSTREAM_ID ? translate(owner.displayName) : owner.displayName
                        }`}</Text>
                    </View>
                </TouchableOpacity>
            </View>

            {sortedWorkstreamAndUserTasks.map((goalTasksData, index) => {
                const goalId = goalTasksData[0]
                const taskList = goalTasksData[1]
                const isLastIndex = sortedWorkstreamAndUserTasks.length - 1 === index

                const needToRender =
                    isActiveOrganizeMode || numberTodayTasks === 0 || totalAmountTasks < numberTodayTasks
                const accumulatedAmountTasks = totalAmountTasks + taskList.length
                const needToShowMoreBtn = accumulatedAmountTasks > numberTodayTasks
                const amountToRender =
                    isActiveOrganizeMode || numberTodayTasks === 0 || numberTodayTasks > accumulatedAmountTasks
                        ? taskList.length
                        : numberTodayTasks - totalAmountTasks
                totalAmountTasks = accumulatedAmountTasks
                showMoreBtn = needToShowMoreBtn
                const goalIndex = taskByGoalsList.findIndex(data => data[0] === goalId)
                return needToRender ? (
                    goalId === NOT_PARENT_GOAL_INDEX ? (
                        <View key={goalId}>
                            {showGneralTasksHeader && (
                                <SwipeableGeneralTasksHeader
                                    projectId={projectId}
                                    taskList={taskList}
                                    dateIndex={dateIndex}
                                    instanceKey={instanceKey}
                                />
                            )}
                            <TasksList
                                projectId={projectId}
                                dateIndex={dateIndex}
                                subtaskByTask={subtaskByTask}
                                isActiveOrganizeMode={isActiveOrganizeMode}
                                taskList={taskList}
                                taskListIndex={STREAM_AND_USER_TASKS_INDEX}
                                goalIndex={goalIndex}
                                amountToRender={amountToRender}
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
                            taskListIndex={STREAM_AND_USER_TASKS_INDEX}
                            containerStyle={isLastIndex ? null : { marginBottom: 16 }}
                            nestedTaskListIndex={nestedTaskListIndex}
                            goalIndex={goalIndex}
                            amountToRender={amountToRender}
                            instanceKey={instanceKey}
                        />
                    )
                ) : null
            })}

            {needShowMoreBtn && (
                <ShowMoreButton expanded={false} contract={() => {}} expand={expandTasks} style={{ marginBottom: 0 }} />
            )}
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
})
