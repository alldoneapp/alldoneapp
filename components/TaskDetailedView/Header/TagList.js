import React from 'react'
import { View } from 'react-native'
import DetailViewHeaderTags from '../../UIComponents/DetailViewHeaderTags'
import TaskRecurrence from '../../Tags/TaskRecurrence'
import TaskEstimation from '../../Tags/TaskEstimation'
import { OPEN_STEP, RECURRENCE_NEVER, TASK_ASSIGNEE_ASSISTANT_TYPE } from '../../TaskListView/Utils/TasksHelper'
import { useSelector } from 'react-redux'
import SharedHelper from '../../../utils/SharedHelper'
import { FEED_TASK_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import CopyLinkButton from '../../UIControls/CopyLinkButton'
import PrivacyTag from '../../Tags/PrivacyTag'
import ProjectTag from '../../Tags/ProjectTag'
import TaskIdTag from '../../Tags/TaskIdTag'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { DV_TAB_TASK_CHAT } from '../../../utils/TabNavigationConstants'
import OpenInNewWindowButton from '../../UIControls/OpenInNewWindowButton'
import DvBotButton from '../../UIControls/DvBotButton'
import DvSearchButton from '../../UIControls/DvSearchButton'
// NOTE: the calendar chip is deliberately NOT rendered here. SocialText already renders it inline
// in front of the task name (LeftTagsAndIcons), so a copy in this row was a duplicate that also
// pushed the metadata row onto an extra line on mobile (AT-2341).

export default function TagList({ projectId, task, assistantId, setAssistantId, updateObjectState }) {
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
        <DetailViewHeaderTags
            projectTag={<ProjectTag project={project} disabled={!accessGranted} isMobile={isMobile} truncate />}
            privacyTag={
                <PrivacyTag
                    projectId={projectId}
                    object={task}
                    objectType={FEED_TASK_OBJECT_TYPE}
                    disabled={!accessGranted || !loggedUserCanUpdateObject || isAssistant}
                    isMobile={isMobile}
                />
            }
            actions={
                <>
                    <CopyLinkButton style={{ top: -5, marginRight: 8 }} />
                    {accessGranted && (
                        <>
                            <DvSearchButton style={{ top: -5 }} />
                            <DvBotButton
                                style={{ top: -5 }}
                                navItem={DV_TAB_TASK_CHAT}
                                projectId={projectId}
                                assistantId={assistantId}
                                setAssistantId={setAssistantId}
                                objectId={task.id}
                                showThreadModelBadge={true}
                                objectType={FEED_TASK_OBJECT_TYPE}
                                parentObject={task}
                                updateObjectState={updateObjectState}
                                resolveProjectAssistant={true}
                            />
                        </>
                    )}
                    <OpenInNewWindowButton style={{ top: -5 }} />
                </>
            }
        >
            {task.humanReadableId && (
                <View>
                    <TaskIdTag
                        taskId={task.id}
                        projectId={projectId}
                        humanReadableId={task.humanReadableId}
                        disabled={!accessGranted}
                        isMobile={isMobile}
                    />
                </View>
            )}
            {task.recurrence !== RECURRENCE_NEVER ? (
                <View>
                    <TaskRecurrence
                        task={task}
                        projectId={projectId}
                        disabled={!accessGranted || !loggedUserCanUpdateObject}
                        isMobile={isMobile}
                    />
                </View>
            ) : null}
            {task.estimations[OPEN_STEP] > 0 && (
                <View>
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
        </DetailViewHeaderTags>
    )
}
