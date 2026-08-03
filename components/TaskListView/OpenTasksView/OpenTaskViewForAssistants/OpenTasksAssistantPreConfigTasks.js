import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'
import { watchAssistantTasks } from '../../../../utils/backends/Assistants/assistantsFirestore'
import { unwatch } from '../../../../utils/backends/firestore'
import WhatsAppAssistantLine from './WhatsAppAssistantLine'
import { GLOBAL_PROJECT_ID } from '../../../AdminPanel/Assistants/assistantsHelper'
import TasksHelper, { RECURRENCE_NEVER } from '../../../TaskListView/Utils/TasksHelper'
import { WorkflowConfigurationLink } from './WorkflowTaskCreator'
import { buildAssistantScheduleOccurrences } from '../../../../utils/assistantSchedule'
import AssistantLine from '../../../MyDayView/AssistantLine/AssistantLine'
import NavigationService from '../../../../utils/NavigationService'
import { setSelectedNavItem } from '../../../../redux/actions'
import { DV_TAB_ASSISTANT_CUSTOMIZATIONS } from '../../../../utils/TabNavigationConstants'

export default function OpenTasksAssistantPreConfigTasks({ projectId, children }) {
    const dispatch = useDispatch()
    const currentUser = useSelector(state => state.currentUser)
    const globalAssistants = useSelector(state => state.globalAssistants)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const realProjectIds = useSelector(state => state.loggedUser.realProjectIds)
    const project = useSelector(state => state.loggedUserProjectsMap[projectId])
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const administratorUserId = useSelector(state => state.administratorUser?.uid)
    const showFloatPopup = useSelector(state => state.showFloatPopup)
    const [tasks, setTasks] = useState([])

    const isGlobalAssistant = globalAssistants.find(item => item.uid === currentUser.uid)
    const tasksProjectId = isGlobalAssistant ? GLOBAL_PROJECT_ID : projectId
    const canCreateWorkflowTask = !isAnonymous && Array.isArray(realProjectIds) && realProjectIds.includes(projectId)
    const canEditAssistant =
        !isAnonymous &&
        ((!isGlobalAssistant && !currentUser.fromTemplate) ||
            (isGlobalAssistant && administratorUserId === loggedUserId))

    const openAssistantEditor = () => {
        if (showFloatPopup) return
        NavigationService.navigate('AssistantDetailedView', {
            assistantId: currentUser.uid,
            projectId: isGlobalAssistant ? GLOBAL_PROJECT_ID : projectId,
        })
        dispatch(setSelectedNavItem(DV_TAB_ASSISTANT_CUSTOMIZATIONS))
    }

    useEffect(() => {
        const watcherKey = v4()
        watchAssistantTasks(tasksProjectId, currentUser.uid, watcherKey, setTasks)
        return () => {
            unwatch(watcherKey)
        }
    }, [currentUser.uid, tasksProjectId])

    const isRecurringTask = task => {
        const recurrenceByUser = task?.recurrenceByUser || {}
        const hasRecurringUser = Object.values(recurrenceByUser).some(
            recurrence => recurrence && recurrence !== RECURRENCE_NEVER
        )

        return hasRecurringUser || (!!task?.recurrence && task.recurrence !== RECURRENCE_NEVER)
    }

    const scheduledTasks = tasks.filter(task => isRecurringTask(task))
    const scheduledOccurrences = useMemo(
        () => buildAssistantScheduleOccurrences(scheduledTasks, userId => TasksHelper.getPeopleById(userId, projectId)),
        [scheduledTasks, projectId]
    )
    const timelineChildren = React.Children.map(children, child =>
        React.isValidElement(child)
            ? React.cloneElement(child, {
                  assistantScheduleOccurrences: scheduledOccurrences,
                  assistantScheduleContext: {
                      tasksProjectId,
                      assistant: currentUser,
                      disabled: !!isGlobalAssistant || !canCreateWorkflowTask,
                  },
                  assistantTaskCreatorContext: isGlobalAssistant
                      ? null
                      : {
                            projectId,
                            assistant: currentUser,
                            disabled: !canCreateWorkflowTask,
                            showConfigurationLink: false,
                        },
              })
            : child
    )

    return (
        <View style={localStyles.container}>
            <AssistantLine
                showLastComment
                removeBottomSpace
                useAssistantProjectContext={false}
                projectOverride={project}
                assistantIdOverride={currentUser.uid}
                showAllQuickActions
                preferAssistantIdOverride
                scopeLastCommentToAssistant
                showEditAssistantButton={canEditAssistant}
                onEditAssistant={openAssistantEditor}
            />
            {currentUser.displayName === 'Anna Alldone' && (
                <View style={localStyles.section}>
                    <WhatsAppAssistantLine assistant={currentUser} projectId={projectId} />
                </View>
            )}

            <View style={[localStyles.tasksHeaderRow, localStyles.majorSection]}>
                <Text style={localStyles.header}>{translate('Tasks')}</Text>
                {!isGlobalAssistant && <WorkflowConfigurationLink projectId={projectId} assistant={currentUser} />}
            </View>
            {!!isGlobalAssistant && (
                <Text style={localStyles.readOnlyText}>
                    {translate('Copy this assistant to configure its workflow and add tasks')}
                </Text>
            )}
            {timelineChildren}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 21,
        marginBottom: 44,
    },
    header: {
        ...styles.title6,
        color: colors.Text01,
    },
    section: {
        marginTop: 8,
    },
    majorSection: {
        marginTop: 32,
    },
    tasksHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    readOnlyText: {
        ...styles.body2,
        color: colors.Text03,
        marginTop: 8,
    },
})
