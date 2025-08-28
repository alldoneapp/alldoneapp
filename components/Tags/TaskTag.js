import React, { useEffect, useRef, useState } from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import Icon from '../Icon'
import styles, { colors, windowTagStyle } from '../styles/global'
import SVGGenericUser from '../../assets/svg/SVGGenericUser'
import ReactDOM from 'react-dom'
import useWindowSize from '../../utils/useWindowSize'
import { usePrevious } from '../../utils/UsePrevious'
import { handleNestedLinks } from '../../utils/LinkingHelper'
import TasksHelper, {
    OPEN_STEP,
    RECURRENCE_NEVER,
    TASK_ASSIGNEE_ASSISTANT_TYPE,
} from '../TaskListView/Utils/TasksHelper'
import TaskEstimation from './TaskEstimation'
import DescriptionTag from './DescriptionTag'
import TaskRecurrence from './TaskRecurrence'
import PrivacyTag from './PrivacyTag'
import { FEED_TASK_OBJECT_TYPE } from '../Feeds/Utils/FeedsConstants'
import Backend from '../../utils/BackendBridge'
import TaskSubTasks from './TaskSubTasks'
import TaskSummation from './TaskSummation'
import TaskCommentsWrapper from './TaskCommentsWrapper'
import DateTagButton from '../UIControls/DateTagButton'
import { WORKSTREAM_ID_PREFIX } from '../Workstreams/WorkstreamHelper'
import { isEmpty } from 'lodash'
import LoadingTag from './LoadingTag'
import { getEstimationRealValue } from '../../utils/EstimationHelper'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { getAssistant } from '../AdminPanel/Assistants/assistantsHelper'
import { cleanTextMetaData } from '../../functions/Utils/parseTextUtils'
import { setTaskDescription } from '../../utils/backends/Tasks/tasksFirestore'

export default function TaskTag({
    editorId,
    activeNoteId,
    projectId,
    isLoading,
    taskId,
    task,
    onPress,
    isDeleted,
    disabled,
    saveDueDateCallback,
}) {
    const virtualQuillLoaded = useSelector(state => state.virtualQuillLoaded)
    const loggedUser = useSelector(state => state.loggedUser)
    const [width, height] = useWindowSize()
    const previousWidth = usePrevious(width)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const tablet = useSelector(state => state.isMiddleScreen)
    const [maxWidth, setMaxWidth] = useState(0)
    const [tagsWidth, setTagsWidth] = useState(0)
    const containerRef = useRef()
    const [icon, setIcon] = useState('')
    const [name, setName] = useState('')
    const [photoUrl, setPhotoUrl] = useState('')
    const [subtasks, setSubtasks] = useState([])
    const [sumEstimation, setSumEstimation] = useState(0)
    const commentsData = task?.commentsData
    let ownerEstimation = task?.estimations ? task.estimations[OPEN_STEP] : 0
    const ownerIsWorkstream = task?.userId?.startsWith(WORKSTREAM_ID_PREFIX)

    useEffect(() => {
        if (!isLoading) {
            setName(getName(task))
            setIcon(getIco(task))
            setPhotoUrl(getPhotoUrl(projectId, task))

            if (task) {
                const watcherKey = v4()
                Backend.watchSubtasks(projectId, taskId, watcherKey, subtasks => {
                    setSubtasks(subtasks)
                    setSumEstimation(
                        subtasks.reduce((sum, subTask) => {
                            return sum + getEstimationRealValue(projectId, subTask.estimations[OPEN_STEP])
                        }, 0)
                    )
                })

                return () => Backend.unwatch(watcherKey)
            }
        }
    }, [isLoading, task])

    useEffect(() => {
        if (!isLoading && !virtualQuillLoaded) {
            if (width < previousWidth) {
                setMaxWidth(maxWidth - (previousWidth - width) - 50)
            } else {
                onLayout()
            }
        }
    }, [isLoading, width])

    const onLayout = () => {
        const el = ReactDOM.findDOMNode(containerRef.current)
        const { left } = el.getBoundingClientRect()
        setMaxWidth(width - left - (mobile ? 16 : tablet ? 32 : 72) - 50)
    }

    const onChangeTagsArea = ({
        nativeEvent: {
            layout: { x, y, width, height },
        },
    }) => {
        setTagsWidth(width + 32)
    }

    const updateDescription = description => {
        setTaskDescription(projectId, task.id, description, task, task.description)
    }

    const loggedUserIsTaskOwner = task && task.userId === loggedUser.uid
    const loggedUserCanUpdateObject =
        loggedUserIsTaskOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    return (
        <View
            ref={containerRef}
            onLayout={!isLoading ? onLayout : null}
            style={[
                isLoading ? localStyles.loadingContainer : localStyles.container,
                !isLoading && { maxWidth: maxWidth },
            ]}
        >
            {isLoading && editorId === activeNoteId && <LoadingTag />}
            {!isLoading && (name || isDeleted) ? (
                <View style={localStyles.subContainer}>
                    <TouchableOpacity
                        style={[localStyles.button, { maxWidth: maxWidth - tagsWidth }]}
                        onPress={onPress}
                        disabled={disabled || !loggedUserCanUpdateObject}
                    >
                        <Icon name={icon} color={colors.Primary100} size={16} />
                        <Text style={[localStyles.name, windowTagStyle()]} numberOfLines={1}>
                            {name}
                        </Text>
                    </TouchableOpacity>

                    <View onLayout={onChangeTagsArea} style={localStyles.tagsContainer}>
                        {!isEmpty(task) && (
                            <>
                                {!!commentsData && (
                                    <TaskCommentsWrapper
                                        commentsData={commentsData}
                                        projectId={projectId}
                                        objectId={taskId}
                                        objectType={'tasks'}
                                        userGettingKarmaId={task.userId}
                                        outline={true}
                                        objectName={task.name}
                                        assistantId={task.assistantId}
                                    />
                                )}

                                {task?.isPrivate && (
                                    <PrivacyTag
                                        projectId={projectId}
                                        object={task}
                                        objectType={FEED_TASK_OBJECT_TYPE}
                                        style={{ marginLeft: 2 }}
                                        isMobile={true}
                                        disabled={disabled || !loggedUserCanUpdateObject}
                                        outline={true}
                                    />
                                )}
                                {task.recurrence !== RECURRENCE_NEVER && (
                                    <TaskRecurrence
                                        task={task}
                                        projectId={projectId}
                                        style={{ marginLeft: 2 }}
                                        isMobile={true}
                                        disabled={disabled || !loggedUserCanUpdateObject}
                                        outline={true}
                                    />
                                )}

                                {ownerEstimation > 0 && (
                                    <TaskEstimation
                                        task={task}
                                        projectId={projectId}
                                        style={{ marginLeft: 2 }}
                                        isMobile={true}
                                        currentEstimation={ownerEstimation}
                                        stepId={OPEN_STEP}
                                        photoUrl={photoUrl}
                                        disabled={
                                            task.userIds.length > 1 ||
                                            task.inDone ||
                                            disabled ||
                                            !loggedUserCanUpdateObject
                                        }
                                        outline={true}
                                    />
                                )}

                                {subtasks.length > 0 && (
                                    <TaskSubTasks
                                        amountOfSubTasks={subtasks.length}
                                        style={{ marginLeft: 2 }}
                                        onPress={() => {}}
                                        isMobile={true}
                                        outline={true}
                                    />
                                )}

                                {sumEstimation > 0 && (
                                    <TaskSummation
                                        projectId={projectId}
                                        estimation={sumEstimation}
                                        style={{ marginLeft: 2 }}
                                        isMobile={true}
                                        outline={true}
                                    />
                                )}

                                {task && (
                                    <DateTagButton
                                        task={task}
                                        projectId={projectId}
                                        disabled={disabled || !loggedUserCanUpdateObject}
                                        outline={true}
                                        style={{ marginLeft: 2 }}
                                        saveDueDateBeforeSaveTask={saveDueDateCallback}
                                    />
                                )}

                                {task?.description?.length > 0 && (
                                    <DescriptionTag
                                        projectId={projectId}
                                        object={task}
                                        style={{ marginLeft: 2 }}
                                        disabled={disabled || !loggedUserCanUpdateObject}
                                        outline={true}
                                        objectType={FEED_TASK_OBJECT_TYPE}
                                        updateDescription={updateDescription}
                                    />
                                )}
                            </>
                        )}

                        {ownerIsWorkstream ? (
                            <Icon size={20} name="workstream" color={colors.Text03} style={localStyles.avatar} />
                        ) : photoUrl ? (
                            <Image source={{ uri: photoUrl }} style={localStyles.avatar} />
                        ) : (
                            <View style={[localStyles.svg, localStyles.avatar]}>
                                <SVGGenericUser width={20} height={20} svgid={taskId} />
                            </View>
                        )}
                    </View>
                </View>
            ) : null}
        </View>
    )
}

const getIco = task => {
    if (!task) {
        return 'trash-2'
    } else {
        const { done, userIds } = task
        if (done) {
            return 'square-checked-gray'
        }
        if (userIds.length > 1) {
            return 'clock'
        }
        return 'square'
    }
}

const getName = task => {
    if (task) {
        const cleanedText = cleanTextMetaData(task.extendedName)
        return handleNestedLinks(cleanedText)
    }
    return 'Task removed'
}

const getPhotoUrl = (projectId, task) => {
    if (!task) {
        return ''
    } else {
        const user =
            task.assigneeType === TASK_ASSIGNEE_ASSISTANT_TYPE
                ? getAssistant(task.userId)
                : TasksHelper.getUserInProject(projectId, task.userId) ||
                  TasksHelper.getContactInProject(projectId, task.userId) || { photoURL: '' }
        return user ? user.photoURL : ''
    }
}

const localStyles = StyleSheet.create({
    container: {
        display: 'inline-flex',
        maxWidth: '100%',
        minWidth: 150,
    },
    loadingContainer: {
        display: 'inline-flex',
        maxWidth: '100%',
    },
    subContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 4,
        paddingRight: 2,
        backgroundColor: colors.UtilityBlue112,
        height: 24,
        borderRadius: 50,
    },
    button: {
        ...styles.subtitle2,
        flexDirection: 'row',
        alignItems: 'center',
        height: 24,
        fontSize: 18,
        overflow: 'hidden',
    },
    name: {
        ...styles.subtitle2,
        color: colors.Primary100,
        marginLeft: 6,
        marginRight: 10,
    },
    avatar: {
        width: 20,
        height: 20,
        borderRadius: 100,
        marginLeft: 6,
    },
    svg: {
        overflow: 'hidden',
    },
    tagsContainer: {
        flexDirection: 'row',
    },
})
