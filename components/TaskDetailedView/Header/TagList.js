import React from 'react'
import { StyleSheet, View } from 'react-native'
import TaskRecurrence from '../../Tags/TaskRecurrence'
import TaskEstimation from '../../Tags/TaskEstimation'
import { OPEN_STEP, RECURRENCE_NEVER, TASK_ASSIGNEE_ASSISTANT_TYPE } from '../../TaskListView/Utils/TasksHelper'
import { useSelector } from 'react-redux'
import SharedHelper from '../../../utils/SharedHelper'
import { FEED_TASK_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import CopyLinkButton from '../../UIControls/CopyLinkButton'
import PrivacyTag from '../../Tags/PrivacyTag'
import ProjectTag from '../../Tags/ProjectTag'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { DV_TAB_TASK_CHAT } from '../../../utils/TabNavigationConstants'
import OpenInNewWindowButton from '../../UIControls/OpenInNewWindowButton'
import DvBotButton from '../../UIControls/DvBotButton'
import CalendarTag from '../../Tags/CalendarTag'

export default function TagList({ projectId, task }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const tablet = useSelector(state => state.isMiddleScreen)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)
    const project = ProjectHelper.getProjectById(projectId)
    const isMobile = loggedUser.sidebarExpanded ? tablet : mobile

    const loggedUserIsTaskOwner = task.userId === loggedUser.uid
    const loggedUserCanUpdateObject =
        loggedUserIsTaskOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    const isAssistant = task.assigneeType === TASK_ASSIGNEE_ASSISTANT_TYPE

    return (
        <View style={localStyles.container}>
            <View style={localStyles.tagList}>
                <View style={{ marginRight: 12 }}>
                    <ProjectTag project={project} disabled={!accessGranted} isMobile={isMobile} />
                </View>
                <View style={{ marginRight: 12 }}>
                    <PrivacyTag
                        projectId={projectId}
                        object={task}
                        objectType={FEED_TASK_OBJECT_TYPE}
                        disabled={!accessGranted || !loggedUserCanUpdateObject || isAssistant}
                        isMobile={isMobile}
                    />
                </View>
                {task.recurrence !== RECURRENCE_NEVER ? (
                    <View style={{ marginRight: 12 }}>
                        <TaskRecurrence
                            task={task}
                            projectId={projectId}
                            disabled={!accessGranted || !loggedUserCanUpdateObject}
                            isMobile={isMobile}
                        />
                    </View>
                ) : null}
                {task.estimations[OPEN_STEP] > 0 && (
                    <View style={{ marginRight: 12 }}>
                        <TaskEstimation
                            projectId={projectId}
                            task={task}
                            currentEstimation={task.estimations[OPEN_STEP]}
                            stepId={OPEN_STEP}
                            disabled={
                                !accessGranted || !loggedUserCanUpdateObject || task.userIds.length > 1 || task.inDone
                            }
                            isMobile={isMobile}
                        />
                    </View>
                )}
                {task.calendarData && (
                    <View>
                        <CalendarTag calendarData={task.calendarData} />
                    </View>
                )}
            </View>

            <View style={{ flexDirection: 'row' }}>
                <CopyLinkButton style={{ top: -5, marginRight: 8 }} />
                <DvBotButton
                    style={{ top: -5 }}
                    navItem={DV_TAB_TASK_CHAT}
                    projectId={projectId}
                    assistantId={task.assistantId}
                />
                <OpenInNewWindowButton style={{ top: -5 }} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
    },
    tagList: {
        flex: 1,
        flexGrow: 1,
        flexDirection: 'row',
    },
})
