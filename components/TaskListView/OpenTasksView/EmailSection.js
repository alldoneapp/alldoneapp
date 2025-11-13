import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import GoogleGmail from '../../../assets/svg/GoogleGmail'
import { EMAIL_TASK_INDEX, NOT_PARENT_GOAL_INDEX, sortGoalTasksGorups } from '../../../utils/backends/openTasks'
import TasksList from './TasksList'
import { sortBy } from 'lodash'
import ParentGoalSection from './ParentGoalSection'
import ReloadCalendar from '../../UIComponents/ReloadCalendar'
import { checkIfGmailIsConnected } from '../../../utils/backends/firestore'
import GoogleApi from '../../../apis/google/GoogleApi'
import { useSelector } from 'react-redux'
import GeneralTasksHeader from './GeneralTasksHeader'
import SwipeableGeneralTasksHeader from './SwipeableGeneralTasksHeader'

export default function EmailSection({ dateIndex, projectId, isActiveOrganizeMode, instanceKey }) {
    const isConnected = useSelector(state => state.loggedUser.apisConnected?.[projectId]?.gmail)
    const emailTasks = useSelector(state => state.filteredOpenTasksStore[instanceKey][dateIndex][EMAIL_TASK_INDEX])
    const openMilestones = useSelector(state => state.openMilestonesByProjectInTasks[projectId])
    const doneMilestones = useSelector(state => state.doneMilestonesByProjectInTasks[projectId])
    const goalsById = useSelector(state => state.goalsByProjectInTasks[projectId])
    const currentUserId = useSelector(state => state.currentUser.uid)
    const [showReload, setShowReload] = useState(false)

    useEffect(() => {
        GoogleApi.onLoad(() => {
            setShowReload(GoogleApi.checkGmailAccessGranted())
        })
    }, [])

    const openLink = () => {
        return window.open(
            'https://mail.google.com/mail/u/?' + `authuser=${emailTasks[0][1][0].gmailData.email}`,
            '_blank'
        )
    }

    const goalsPositionId = sortGoalTasksGorups(
        projectId,
        openMilestones,
        doneMilestones,
        goalsById,
        currentUserId,
        emailTasks
    )

    if (!goalsPositionId) return null

    const sortedEmailTasks = [...emailTasks]
    sortedEmailTasks.sort((a, b) => goalsPositionId[a[0]] - goalsPositionId[b[0]])

    const showGneralTasksHeader = sortedEmailTasks.length > 0 && sortedEmailTasks[0][0] !== NOT_PARENT_GOAL_INDEX

    return (
        <View style={localStyles.container}>
            <View style={localStyles.subContainer}>
                <View style={localStyles.centeredRow}>
                    <TouchableOpacity onPress={openLink} style={{ flexDirection: 'row' }}>
                        <GoogleGmail />
                        <Text style={localStyles.title}>Google Gmail</Text>
                    </TouchableOpacity>
                    {showReload && isConnected && (
                        <ReloadCalendar projectId={projectId} Promise={checkIfGmailIsConnected} />
                    )}
                </View>
            </View>

            {sortedEmailTasks.map((goalTasksData, index) => {
                const goalId = goalTasksData[0]
                const taskList = goalTasksData[1]
                const isLastIndex = sortedEmailTasks.length - 1 === index
                const goalIndex = emailTasks.findIndex(data => data[0] === goalId)
                return goalId === NOT_PARENT_GOAL_INDEX ? (
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
                            subtaskByTask={[]}
                            isActiveOrganizeMode={isActiveOrganizeMode}
                            taskList={sortBy(taskList, [item => item.sortIndex])}
                            taskListIndex={EMAIL_TASK_INDEX}
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
                        subtaskByTask={[]}
                        isActiveOrganizeMode={isActiveOrganizeMode}
                        taskList={sortBy(taskList, [item => item.sortIndex])}
                        taskListIndex={EMAIL_TASK_INDEX}
                        containerStyle={isLastIndex ? null : { marginBottom: 16 }}
                        goalIndex={goalIndex}
                        instanceKey={instanceKey}
                    />
                )
            })}
        </View>
    )
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
    title: {
        ...styles.caption1,
        color: colors.Text03,
        marginLeft: 8,
    },
})
