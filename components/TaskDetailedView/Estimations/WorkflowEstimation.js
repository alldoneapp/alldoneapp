import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import WorkflowHeader from './WorkflowHeader'
import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import Backend from '../../../utils/BackendBridge'
import URLsTasks, { URL_TASK_DETAILS_ESTIMATION } from '../../../URLSystem/Tasks/URLsTasks'
import ContactsHelper from '../../ContactsView/Utils/ContactsHelper'
import NavigationService from '../../../utils/NavigationService'
import WorkflowStepWrapper from './WorkflowStepWrapper'
import WorkflowOpenWrapper from './WorkflowOpenWrapper'
import TasksHelper, { DONE_STEP, OPEN_STEP, TASK_ASSIGNEE_ASSISTANT_TYPE } from '../../TaskListView/Utils/TasksHelper'
import { chronoEntriesOrder } from '../../../utils/HelperFunctions'
import { useSelector } from 'react-redux'
import SharedHelper from '../../../utils/SharedHelper'
import { DV_TAB_TASK_ESTIMATIONS, DV_TAB_USER_WORKFLOW } from '../../../utils/TabNavigationConstants'
import { WORKSTREAM_ID_PREFIX } from '../../Workstreams/WorkstreamHelper'
import { translate } from '../../../i18n/TranslationService'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import {
    moveTasksFromDone,
    moveTasksFromMiddleOfWorkflow,
    moveTasksFromOpen,
} from '../../../utils/backends/Tasks/tasksFirestore'

const WorkflowEstimation = ({ task, projectId }) => {
    const selectedTab = useSelector(state => state.selectedNavItem)
    const usersInProject = useSelector(state => state.projectUsers[projectId])
    const project = useSelector(state => state.loggedUserProjectsMap[projectId])
    const loggedUser = useSelector(state => state.loggedUser)
    const smallScreen = useSelector(state => state.smallScreen)
    const [workflowSteps, setWorkflowSteps] = useState([])
    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)
    const taskFromWorkstreamOrContactOrAssistant =
        task.userId.startsWith(WORKSTREAM_ID_PREFIX) ||
        !!TasksHelper.getContactInProject(projectId, task.userId) ||
        task.assigneeType === TASK_ASSIGNEE_ASSISTANT_TYPE
    let taskOwner = {}

    for (let user of usersInProject) {
        if (task.userId === user.uid) {
            taskOwner = user
            break
        }
    }

    const getCurrentStepId = () => {
        return task.inDone ? DONE_STEP : task.stepHistory[task.stepHistory.length - 1]
    }

    const onNewStep = globalWorkflow => {
        if (globalWorkflow && globalWorkflow[projectId]) {
            const workflow = globalWorkflow[projectId]
            const workflowSteps = Object.entries(workflow).sort(chronoEntriesOrder)
            setWorkflowSteps(workflowSteps)
        } else {
            setWorkflowSteps([])
        }
    }

    const goToUserWorkflowDetails = () => {
        return ContactsHelper.processURLPeopleDetailsTab(
            NavigationService,
            DV_TAB_USER_WORKFLOW,
            projectId,
            task.userId
        )
    }

    const getFormattedName = taskOwner => {
        if (taskOwner != null && taskOwner.displayName != null) {
            if (taskOwner.displayName === loggedUser.displayName) {
                return translate('your')
            }
            let name = taskOwner.displayName.split(' ')[0]
            if (name[name.length - 1] === 's') {
                return name + `' `
            }
            return name + `'s`
        }
        return ''
    }

    const onStepPress = (selectedStepId, _currentStepIndex) => {
        if (accessGranted && selectedStepId !== getCurrentStepId()) {
            if (task.inDone) {
                moveTasksFromDone(projectId, task, selectedStepId)
            } else if (task.userIds.length === 1) {
                moveTasksFromOpen(projectId, task, selectedStepId, null, null, task.estimations, '')
            } else {
                moveTasksFromMiddleOfWorkflow(projectId, task, selectedStepId, null, null, task.estimations, '')
            }
        }
    }

    const writeBrowserURL = () => {
        if (selectedTab === DV_TAB_TASK_ESTIMATIONS) {
            const data = { projectId: projectId, task: task.id }
            URLsTasks.push(URL_TASK_DETAILS_ESTIMATION, data, projectId, task.id)
        }
    }

    useEffect(() => {
        if (!taskFromWorkstreamOrContactOrAssistant) {
            Backend.onUserWorkflowChange(task.userId, onNewStep)
            writeBrowserURL()

            return () => Backend.offOnUserWorkflowChange(task.userId)
        }
    }, [])

    const loggedUserIsTaskOwner = task.userId === loggedUser.uid
    const loggedUserCanUpdateObject =
        loggedUserIsTaskOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    const currentStepIndex = workflowSteps.findIndex(entry => {
        return entry[0] === task.stepHistory[task.stepHistory.length - 1]
    })

    return (
        <View>
            <WorkflowHeader stepsAmount={4} />
            <View style={localStyles.subContainer}>
                <Icon name="info" size={16} color={colors.Text03} />
                <Text style={[styles.caption2, localStyles.hintText]}>
                    {translate('Here you can estimate each workflow step and choose to which step the task will move')}
                    {!taskFromWorkstreamOrContactOrAssistant && (
                        <>
                            {` `}
                            {translate('Follow this')}
                            {` `}
                            <TouchableOpacity onPress={goToUserWorkflowDetails} disabled={!accessGranted}>
                                <Text
                                    style={[
                                        styles.caption2,
                                        { color: colors.UtilityBlue200, textDecorationLine: 'underline' },
                                    ]}
                                >
                                    {translate('Link')}
                                </Text>
                            </TouchableOpacity>{' '}
                            {translate('if you want to edit User workflow steps for Name project', {
                                user: getFormattedName(taskOwner),
                                project: project.name,
                            })}
                        </>
                    )}
                </Text>
            </View>
            <WorkflowOpenWrapper
                onStepPress={onStepPress}
                task={task}
                projectId={projectId}
                currentEstimation={task.estimations[OPEN_STEP] ? task.estimations[OPEN_STEP] : 0}
                disabled={!loggedUserCanUpdateObject}
            />
            <View style={localStyles.stepsContainer}>
                {workflowSteps.map((stepEntry, index) => {
                    const id = stepEntry[0]
                    const step = stepEntry[1]
                    const isCurrentStep = !task.inDone && id === task.stepHistory[task.stepHistory.length - 1]
                    const isBeforeCurrentStep = task.inDone || index < currentStepIndex
                    return (
                        <WorkflowStepWrapper
                            key={id}
                            onStepPress={onStepPress}
                            currentEstimation={task.estimations[id] ? task.estimations[id] : 0}
                            isCurrentStep={isCurrentStep}
                            stepNumber={index + 1}
                            step={{ id, ...step }}
                            smallScreen={smallScreen}
                            task={task}
                            projectId={projectId}
                            disabled={!loggedUserCanUpdateObject}
                            isBeforeCurrentStep={isBeforeCurrentStep}
                        />
                    )
                })}
            </View>
            <TouchableOpacity
                style={[
                    localStyles.openTaskContainer,
                    task.inDone ? { backgroundColor: colors.UtilityBlue100 } : undefined,
                ]}
                onPress={() => onStepPress(DONE_STEP)}
                accessible={false}
                disabled={!loggedUserCanUpdateObject}
            >
                <Icon name="square-checked-gray" size={24} color={colors.Gray400} />
                <View style={{ marginLeft: 8 }}>
                    <Text style={[styles.subtitle2, { color: colors.Text02 }]}>{translate('Done task')}</Text>
                </View>
            </TouchableOpacity>
        </View>
    )
}
export default WorkflowEstimation

const localStyles = StyleSheet.create({
    openTaskContainer: {
        flexDirection: 'row',
        height: 56,
        alignItems: 'center',
        paddingLeft: 10,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Grey300,
    },
    stepsContainer: {
        flexDirection: 'column',
        marginTop: 16,
    },
    hintText: {
        color: colors.Text03,
        marginLeft: 8,
        maxWidth: 1000,
        marginTop: -2,
    },
    subContainer: {
        flexDirection: 'row',
        marginTop: 8,
        marginBottom: 12,
    },
})
