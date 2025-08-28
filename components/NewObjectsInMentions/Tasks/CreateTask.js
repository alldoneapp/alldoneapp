import React, { useEffect, useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import { StyleSheet, View } from 'react-native'
import { isEqual } from 'lodash'

import TasksHelper, { OPEN_STEP } from '../../TaskListView/Utils/TasksHelper'
import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import CustomTextInput3 from '../../Feeds/CommentsTextInput/CustomTextInput3'
import { CREATE_TASK_MODAL_THEME, MENTION_MODAL_TASKS_TAB } from '../../Feeds/CommentsTextInput/textInputHelper'
import AssigneeWrapper from '../../UIComponents/FloatModals/ManageTaskModal/AssigneeWrapper'
import PrivacyWrapper from '../../UIComponents/FloatModals/ManageTaskModal/PrivacyWrapper'
import { FEED_TASK_OBJECT_TYPE } from '../../Feeds/Utils/FeedsConstants'
import HighlightWrapper from '../../UIComponents/FloatModals/ManageTaskModal/HighlightWrapper'
import PlusButton from '../Common/PlusButton'
import DueDateWrapper from '../../UIComponents/FloatModals/ManageTaskModal/DueDateWrapper'
import EstimationWrapper from '../../UIComponents/FloatModals/ManageTaskModal/EstimationWrapper'
import Backend from '../../../utils/BackendBridge'
import { setSelectedNavItem, startLoadingData, stopLoadingData } from '../../../redux/actions'
import NavigationService from '../../../utils/NavigationService'
import { translate } from '../../../i18n/TranslationService'
import store from '../../../redux/store'
import {
    COMMENT_MODAL_ID,
    exitsOpenModals,
    MENTION_MODAL_ID,
    TAGS_INTERACTION_MODAL_ID,
    TASK_PARENT_GOAL_MODAL_ID,
} from '../../ModalsManager/modalsManager'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { DV_TAB_TASK_PROPERTIES } from '../../../utils/TabNavigationConstants'
import { getUserPresentationDataInProject } from '../../ContactsView/Utils/ContactsHelper'
import { createTaskWithService } from '../../../utils/backends/Tasks/TaskServiceFrontendHelper'

export default function CreateTask({ projectId, containerStyle, selectItemToMention, modalId, mentionText }) {
    const isGuide = !!ProjectHelper.getProjectById(projectId).parentTemplateId
    const dispatch = useDispatch()
    const [sendingData, setSendingData] = useState(false)
    const [task, setTask] = useState(TasksHelper.getNewDefaultTask(isGuide))
    const [assignee, setAssignee] = useState(getUserPresentationDataInProject(projectId, task.userId))
    const [linkedParentNotesUrl, setLinkedParentNotesUrl] = useState([])
    const [linkedParentTasksUrl, setLinkedParentTasksUrl] = useState([])
    const [linkedParentContactsUrl, setLinkedParentContactsUrl] = useState([])
    const [linkedParentProjectsUrl, setLinkedParentProjectsUrl] = useState([])
    const [linkedParentGoalsUrl, setLinkedParentGoalsUrl] = useState([])
    const [linkedParentSkillsUrl, setLinkedParentSkillsUrl] = useState([])
    const [linkedParentAssistantsUrl, setLinkedParentAssistantsUrl] = useState([])
    const inputText = useRef()

    const cleanedName = task?.extendedName?.trim()

    useEffect(() => {
        inputText?.current?.focus()
    }, [])

    const onChangeText = (
        extendedName,
        linkedParentNotesUrl,
        linkedParentTasksUrl,
        linkedParentContactsUrl,
        linkedParentProjectsUrl,
        linkedParentGoalsUrl,
        linkedParentSkillsUrl,
        linkedParentAssistantsUrl
    ) => {
        if (extendedName !== '') {
            setLinkedParentNotesUrl(linkedParentNotesUrl)
            setLinkedParentTasksUrl(linkedParentTasksUrl)
            setLinkedParentContactsUrl(linkedParentContactsUrl)
            setLinkedParentProjectsUrl(linkedParentProjectsUrl)
            setLinkedParentGoalsUrl(linkedParentGoalsUrl)
            setLinkedParentSkillsUrl(linkedParentSkillsUrl)
            setLinkedParentAssistantsUrl(linkedParentAssistantsUrl)
        }
        setTask(task => ({ ...task, extendedName }))
    }

    const setPrivacy = (isPrivate, isPublicFor) => {
        // setTask(task => ({ ...task, isPrivate, isPublicFor }))
        addTask(false, { ...task, isPrivate, isPublicFor })
    }

    const setColor = color => {
        // setTask(task => ({ ...task, hasStar: color }))
        addTask(false, { ...task, hasStar: color })
    }

    const setEstimation = estimationValue => {
        if (estimationValue !== undefined) addTask(false, { ...task, estimations: { [OPEN_STEP]: estimationValue } })
    }

    const setAutoEstimation = autoEstimation => {
        setTask({ ...task, autoEstimation })
    }

    const setDueDate = dueDate => {
        if (dueDate !== undefined) {
            // setTask(task => ({ ...task, dueDate }))
            addTask(false, { ...task, dueDate })
        }
    }

    const setToBacklog = () => {
        addTask(false, { ...task, dueDate: Number.MAX_SAFE_INTEGER })
    }

    const setTaskAssignee = (user, observers) => {
        const { uid } = user
        const observersIds = observers.map(user => user.uid)
        if (uid !== task.userId || !isEqual(observersIds, task.observersIds)) {
            setTask(task => ({
                ...task,
                userId: uid,
                userIds: [uid],
                currentReviewerId: uid,
                observersIds: observersIds,
            }))
            setAssignee(user)
        }
    }

    const addTask = async (openDetails = false, directTask = null) => {
        const newTask = directTask || { ...task }
        newTask.extendedName = task.extendedName.trim()
        newTask.name = TasksHelper.getTaskNameWithoutMeta(newTask.extendedName)

        if (newTask.extendedName.length > 0) {
            dispatch(startLoadingData())
            setSendingData(true)

            await createTaskWithService(
                {
                    projectId,
                    ...newTask,
                },
                {
                    awaitForTaskCreation: true,
                    tryToGenerateBotAdvice: false,
                    notGenerateMentionTasks: false,
                    notGenerateUpdates: false,
                }
            ).then(taskDB => {
                trySetLinkedObjects(taskDB)

                dispatch(stopLoadingData())
                setSendingData(false)

                if (selectItemToMention) {
                    selectItemToMention(taskDB, MENTION_MODAL_TASKS_TAB, projectId)
                }

                if (openDetails) {
                    NavigationService.navigate('TaskDetailedView', {
                        task: taskDB,
                        projectId: projectId,
                    })
                    store.dispatch(setSelectedNavItem(DV_TAB_TASK_PROPERTIES))
                }
            })
        }
    }

    const trySetLinkedObjects = task => {
        Backend.setLinkedParentObjects(
            projectId,
            {
                linkedParentNotesUrl,
                linkedParentTasksUrl,
                linkedParentContactsUrl,
                linkedParentProjectsUrl,
                linkedParentGoalsUrl,
                linkedParentSkillsUrl,
                linkedParentAssistantsUrl,
            },
            { type: 'task', id: task.id }
        )
    }

    const enterKeyAction = () => {
        const { mentionModalStack } = store.getState()
        if (
            mentionModalStack[0] === modalId &&
            !exitsOpenModals([MENTION_MODAL_ID, COMMENT_MODAL_ID, TAGS_INTERACTION_MODAL_ID, TASK_PARENT_GOAL_MODAL_ID])
        ) {
            addTask()
        }
    }

    return !task ? null : (
        <View style={[localStyles.container, containerStyle]}>
            <View style={localStyles.inputContainer}>
                <Icon name={'plus-square'} size={24} color={colors.Primary100} style={localStyles.icon} />
                <View style={{ marginTop: 2, marginBottom: 26, marginLeft: 28, minHeight: 38 }}>
                    <CustomTextInput3
                        ref={inputText}
                        placeholder={translate('Type to add task')}
                        placeholderTextColor={colors.Text03}
                        onChangeText={onChangeText}
                        multiline={true}
                        externalTextStyle={localStyles.textInputText}
                        caretColor="white"
                        autoFocus={true}
                        setMentionsModalActive={() => {}}
                        initialTextExtended={mentionText || task.extendedName}
                        projectId={projectId}
                        styleTheme={CREATE_TASK_MODAL_THEME}
                        externalAlignment={{ paddingLeft: 0, paddingRight: 0 }}
                        disabledEdition={sendingData}
                        forceTriggerEnterActionForBreakLines={enterKeyAction}
                    />
                </View>
                <View style={localStyles.avatar}>
                    <AssigneeWrapper
                        task={task}
                        projectId={projectId}
                        setAssigneeAndObservers={setTaskAssignee}
                        photoURL={assignee.photoURL}
                        disabled={isGuide}
                    />
                </View>
            </View>
            <View style={localStyles.buttonsContainer}>
                <View style={localStyles.buttonsLeft}>
                    {/*<OpenButton onPress={open} disabled={!cleanedName || sendingData} />*/}

                    <DueDateWrapper
                        task={task}
                        projectId={projectId}
                        setDueDate={setDueDate}
                        setToBacklog={setToBacklog}
                    />

                    <PrivacyWrapper
                        object={task}
                        objectType={FEED_TASK_OBJECT_TYPE}
                        projectId={projectId}
                        setPrivacy={setPrivacy}
                        disabled={!cleanedName || sendingData}
                    />

                    <HighlightWrapper object={task} setColor={setColor} disabled={!cleanedName || sendingData} />

                    <EstimationWrapper
                        task={task}
                        projectId={projectId}
                        setEstimation={setEstimation}
                        setAutoEstimation={setAutoEstimation}
                    />
                </View>
                <View style={localStyles.buttonsRight}>
                    <PlusButton onPress={() => addTask()} disabled={!cleanedName || sendingData} modalId={modalId} />
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderColor: '#162764',
        borderRadius: 4,
    },
    inputContainer: {
        paddingTop: 2,
        paddingHorizontal: 16,
    },
    textInputText: {
        ...styles.body1,
        color: '#ffffff',
    },
    buttonsContainer: {
        flexDirection: 'row',
        backgroundColor: '#162764',
        paddingVertical: 8,
        paddingHorizontal: 8,
    },
    buttonsLeft: {
        flexDirection: 'row',
        flex: 1,
    },
    buttonsRight: {},
    icon: {
        position: 'absolute',
        top: 8,
        left: 8,
    },
    avatar: {
        position: 'absolute',
        top: 8,
        right: 8,
    },
})
