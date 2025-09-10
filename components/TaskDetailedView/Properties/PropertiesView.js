import React, { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import AssignedTo from './AssignedTo'
import DueDate from './DueDate'
import Project from './Project'
import Recurring from './Recurring'
import Privacy from './Privacy'
import CreatedBy from './CreatedBy'
import Highlight from './Highlight'
import Workflow from './Workflow'
import DeleteTask from './DeleteTask'
import Backend from '../../../utils/BackendBridge'
import PropertiesHeader from './PropertiesHeader'
import InheritedPropertiesHeader from './InheritedPropertiesHeader'
import URLsTasks, { URL_TASK_DETAILS_PROPERTIES } from '../../../URLSystem/Tasks/URLsTasks'
import { useSelector } from 'react-redux'
import FollowObject from '../../Followers/FollowObject'
import { FOLLOWER_TASKS_TYPE } from '../../Followers/FollowerConstants'
import SubtasksProperties from './SubtasksProperties'
import SubtasksInheritedProperties from './SubtasksInheritedProperties'
import SharedHelper from '../../../utils/SharedHelper'
import { DV_TAB_TASK_PROPERTIES } from '../../../utils/TabNavigationConstants'
import DescriptionField from './DescriptionField'
import { FEED_PUBLIC_FOR_ALL, FEED_TASK_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import ParentGoal from './ParentGoal'
import ObjectRevisionHistory from '../../NotesView/NotesDV/PropertiesView/ObjectRevisionHistory'
import { RECURRENCE_NEVER, TASK_ASSIGNEE_ASSISTANT_TYPE } from '../../TaskListView/Utils/TasksHelper'
import PostponedAndFollowedCounters from './PostponedAndFollowedCounters'
import RecurrenceCounters from './RecurrenceCounters'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import Premium from './Premium'
import InFocus from './InFocus'
import AssistantProperty from '../../UIComponents/FloatModals/ChangeAssistantModal/AssistantProperty'
import TaskId from './TaskId'

export default function PropertiesView({ project, task, loggedUser }) {
    const [creator, setCreator] = useState({})
    const smallScreen = useSelector(state => state.smallScreen)
    const selectedTab = useSelector(state => state.selectedNavItem)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const accessGranted = SharedHelper.accessGranted(loggedUser, project.id)

    useEffect(() => {
        Backend.getUserOrContactBy(project.id, task.creatorId).then(afterCreatorFetch)
        writeBrowserURL()
    }, [])

    const afterCreatorFetch = user => {
        setCreator(user)
    }

    const writeBrowserURL = () => {
        if (selectedTab === DV_TAB_TASK_PROPERTIES) {
            const data = { projectId: project.id, task: task.id }
            URLsTasks.push(URL_TASK_DETAILS_PROPERTIES, data, project.id, task.id)
        }
    }

    const projectId = project.id
    const loggedUserId = loggedUser.uid
    const hidePrivacyButton = !task.isSubtask && !task.done && task.userIds.length > 1
    const isRecurrentTask = task.recurrence !== RECURRENCE_NEVER

    const loggedUserIsTaskOwner = task.userId === loggedUserId || task.creatorId === loggedUserId
    const loggedUserCanUpdateObject =
        loggedUserIsTaskOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    const isAssistant = task.assigneeType === TASK_ASSIGNEE_ASSISTANT_TYPE

    return (
        <View style={{ flexDirection: 'column', marginBottom: 92 }}>
            <PropertiesHeader />

            {task.parentId ? (
                <View>
                    <SubtasksProperties
                        project={project}
                        task={task}
                        loggedUser={loggedUser}
                        creator={creator}
                        loggedUserCanUpdateObject={loggedUserCanUpdateObject}
                        accessGranted={accessGranted}
                    />
                    <InheritedPropertiesHeader />
                    <SubtasksInheritedProperties
                        project={project}
                        task={task}
                        loggedUserProjects={loggedUserProjects}
                        loggedUserCanUpdateObject={loggedUserCanUpdateObject}
                    />
                </View>
            ) : (
                <View style={smallScreen ? localStyles.panelsContainerMobile : localStyles.panelsContainer}>
                    <View style={smallScreen ? localStyles.leftContainerMobile : localStyles.leftContainer}>
                        <AssignedTo projectId={projectId} task={task} disabled={!accessGranted} />
                        <DueDate
                            projectId={projectId}
                            task={task}
                            disabled={!accessGranted || task.gmailData || !loggedUserCanUpdateObject}
                        />
                        <Project
                            item={{ type: 'task', data: task }}
                            project={project}
                            disabled={!accessGranted || task.gmailData || isAssistant}
                        />
                        <Highlight
                            task={task}
                            projectId={projectId}
                            disabled={!accessGranted || !loggedUserCanUpdateObject}
                        />
                        <Workflow
                            projectId={projectId}
                            task={task}
                            disabled={
                                !accessGranted || task.gmailData || task.calendarData || !loggedUserCanUpdateObject
                            }
                        />
                        {!isRecurrentTask && (
                            <ParentGoal
                                projectId={projectId}
                                task={
                                    !task.parentGoalIsPublicFor ||
                                    task.parentGoalIsPublicFor.includes(FEED_PUBLIC_FOR_ALL) ||
                                    task.parentGoalIsPublicFor.includes(loggedUser.uid)
                                        ? task
                                        : { ...task, parentGoalId: null, parentGoalIsPublicFor: null }
                                }
                                disabled={!accessGranted || !loggedUserCanUpdateObject || isAssistant}
                            />
                        )}
                        {isRecurrentTask && <PostponedAndFollowedCounters task={task} />}
                        {!task.done && loggedUserId === task.currentReviewerId && loggedUserId === task.userId && (
                            <InFocus
                                projectId={projectId}
                                taskId={task.id}
                                disabled={!accessGranted || !loggedUserCanUpdateObject}
                                task={task}
                            />
                        )}
                    </View>

                    <View style={smallScreen ? localStyles.rightContainerMobile : localStyles.rightContainer}>
                        <AssistantProperty
                            projectId={projectId}
                            assistantId={task.assistantId}
                            disabled={!accessGranted || !loggedUserCanUpdateObject}
                            objectId={task.id}
                            objectType={'tasks'}
                        />
                        {isRecurrentTask && (
                            <ParentGoal
                                projectId={projectId}
                                task={
                                    !task.parentGoalIsPublicFor ||
                                    task.parentGoalIsPublicFor.includes(FEED_PUBLIC_FOR_ALL) ||
                                    task.parentGoalIsPublicFor.includes(loggedUser.uid)
                                        ? task
                                        : { ...task, parentGoalId: null, parentGoalIsPublicFor: null }
                                }
                                disabled={!accessGranted || !loggedUserCanUpdateObject}
                            />
                        )}
                        <Privacy
                            projectId={projectId}
                            task={task}
                            disabled={!accessGranted || hidePrivacyButton || !loggedUserCanUpdateObject || isAssistant}
                        />
                        <Recurring
                            projectId={projectId}
                            task={task}
                            disabled={
                                !accessGranted ||
                                task.gmailData ||
                                task.calendarData ||
                                !loggedUserCanUpdateObject ||
                                isAssistant
                            }
                        />
                        {false && (
                            <Premium
                                projectId={projectId}
                                task={task}
                                disabled={!accessGranted || hidePrivacyButton || !loggedUserCanUpdateObject}
                            />
                        )}
                        {isRecurrentTask && <RecurrenceCounters task={task} />}
                        {!isRecurrentTask && <PostponedAndFollowedCounters task={task} />}
                        {accessGranted && (
                            <FollowObject
                                projectId={projectId}
                                followObjectsType={FOLLOWER_TASKS_TYPE}
                                followObjectId={task.id}
                                loggedUserId={loggedUserId}
                                object={task}
                                disabled={!accessGranted}
                            />
                        )}

                        <CreatedBy createdDate={task.created} creator={creator} />
                        <TaskId task={task} />
                    </View>
                </View>
            )}

            <DescriptionField
                projectId={projectId}
                object={task}
                disabled={!accessGranted || task.calendarData || !loggedUserCanUpdateObject || isAssistant}
                objectType={FEED_TASK_OBJECT_TYPE}
                calendarDataTask={task.calendarData}
            />

            {accessGranted && loggedUserCanUpdateObject && (
                <View style={localStyles.deleteButtonContainer}>
                    <ObjectRevisionHistory projectId={projectId} noteId={task.noteId} />
                    <DeleteTask projectId={projectId} task={task} />
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    panelsContainer: {
        flex: 1,
        flexDirection: 'row',
        position: 'relative',
        zIndex: 50,
    },
    panelsContainerMobile: {
        flex: 1,
        flexDirection: 'column',
        position: 'relative',
        zIndex: 50,
    },
    leftContainer: {
        flex: 1,
        flexDirection: 'column',
        paddingRight: 36,
    },
    leftContainerMobile: {
        flex: 1,
        flexDirection: 'column',
    },
    rightContainer: {
        flex: 1,
        flexDirection: 'column',
        paddingLeft: 36,
    },
    rightContainerMobile: {
        flex: 1,
        flexDirection: 'column',
    },
    deleteButtonContainer: {
        marginTop: 24,
    },
})
