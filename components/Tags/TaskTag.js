import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import v4 from 'uuid/v4'

import Icon from '../Icon'
import styles, { colors, windowTagStyle } from '../styles/global'
import SVGGenericUser from '../../assets/svg/SVGGenericUser'
import ReactDOM from 'react-dom'
import useWindowSize from '../../utils/useWindowSize'
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

// The row keeps at least this much space for the icon + title. A task row that has been
// squeezed to nothing is indistinguishable from a task that vanished (AT-2454), so the
// label truncates instead of disappearing, however wrong the measured width is.
export const MIN_TASK_TAG_LABEL_WIDTH = 64

// A task with neither `extendedName` nor `name` maps to an empty string (mapTaskData), and
// an empty title used to render the whole row as `null` — an invisible 150px hole in the
// note. Name it instead so the row is always reachable.
export const UNNAMED_TASK_LABEL = 'Untitled task'

export default function TaskTag({
    editorId,
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
    const mobile = useSelector(state => state.smallScreenNavigation)
    const tablet = useSelector(state => state.isMiddleScreen)
    const [maxWidth, setMaxWidth] = useState(0)
    const [tagsWidth, setTagsWidth] = useState(0)
    const containerRef = useRef()
    const [subtasks, setSubtasks] = useState([])
    const [sumEstimation, setSumEstimation] = useState(0)
    const commentsData = task?.commentsData
    let ownerEstimation = task?.estimations ? task.estimations[OPEN_STEP] : 0
    const ownerIsWorkstream = task?.userId?.startsWith(WORKSTREAM_ID_PREFIX)

    // Derived, not state (AT-2454). These used to be three useState values written from an
    // effect keyed on [isLoading, task], so the first commit after a task arrived rendered
    // with `name === ''` — and `name` is what gated the whole row. Any commit that reached
    // that branch without the effect running again left the row permanently blank. The memo
    // keeps the work on exactly the inputs the old effect was keyed on.
    const { name, icon, photoUrl } = useMemo(
        () =>
            isLoading
                ? { name: '', icon: '', photoUrl: '' }
                : { name: getName(task), icon: getIco(task), photoUrl: getPhotoUrl(projectId, task) },
        [isLoading, task, projectId]
    )

    useEffect(() => {
        if (!isLoading && task) {
            const watcherKey = v4()
            Backend.watchSubtasks(projectId, taskId, watcherKey, subtasks => {
                setSubtasks(subtasks)
                setSumEstimation(
                    subtasks.reduce((sum, subTask) => {
                        return sum + getEstimationRealValue(projectId, subTask.estimations?.[OPEN_STEP])
                    }, 0)
                )
            })

            return () => Backend.unwatch(watcherKey)
        }
    }, [isLoading, task])

    // AT-2454: this used to subtract `(previousWidth - width) + 50` from a stale-closure
    // `maxWidth` on every narrowing step and never gave the 50 back, so dragging the window
    // narrower (which fires dozens of resize events) drove the row's width deeply negative.
    // Always re-measure from the DOM instead — the measurement is the only trustworthy input.
    useEffect(() => {
        if (isLoading || virtualQuillLoaded) return
        measureAvailableWidth()
    }, [isLoading, width, virtualQuillLoaded, mobile, tablet])

    const measureAvailableWidth = () => {
        const el = containerRef.current ? ReactDOM.findDOMNode(containerRef.current) : null
        if (!el || typeof el.getBoundingClientRect !== 'function') return
        const { left } = el.getBoundingClientRect()
        const available = width - left - (mobile ? 16 : tablet ? 32 : 72) - 50
        // A measurement taken while the row is detached, off-screen, mid-reflow or at the far
        // right of the line answers with a useless (often negative) number. Record it as
        // "unknown" and leave the row unconstrained rather than freezing a width that hides it.
        setMaxWidth(available > 0 ? available : 0)
    }

    // Always hand react-native-web a function: `useElementLayout` decides ONCE, on mount,
    // whether to observe the node (its observing effect only depends on [ref, observer]), so
    // passing `null` while the row is still loading meant the row was never observed again
    // and its width was frozen at whatever the single manual measurement produced.
    const onLayout = () => {
        if (isLoading || virtualQuillLoaded) return
        measureAvailableWidth()
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

    // `maxWidth === 0` means "not measured yet / measurement unusable", never "zero pixels
    // wide" (AT-2454). Applying it as a real width is what made a task row vanish.
    const hasMeasuredWidth = maxWidth > 0
    const labelMaxWidth = hasMeasuredWidth ? Math.max(MIN_TASK_TAG_LABEL_WIDTH, maxWidth - tagsWidth) : undefined

    return (
        <View
            ref={containerRef}
            onLayout={onLayout}
            style={[
                isLoading ? localStyles.loadingContainer : localStyles.container,
                !isLoading && hasMeasuredWidth && { maxWidth: maxWidth },
            ]}
        >
            {isLoading && <LoadingTag />}
            {!isLoading ? (
                <View style={localStyles.subContainer}>
                    <TouchableOpacity
                        style={[localStyles.button, labelMaxWidth != null && { maxWidth: labelMaxWidth }]}
                        onPress={onPress}
                        disabled={disabled || !loggedUserCanUpdateObject}
                    >
                        <Icon name={icon} color={colors.Primary100} size={16} />
                        <Text style={[localStyles.name, windowTagStyle()]} numberOfLines={1}>
                            {name || UNNAMED_TASK_LABEL}
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
                                        object={task}
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
        flexDirection: 'row',
        alignItems: 'center',
        height: 24,
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
