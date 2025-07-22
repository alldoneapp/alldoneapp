import React, { useEffect, useRef, useState } from 'react'
import { Animated, Image, StyleSheet, Text, View } from 'react-native'
import FeedInteractionBar from '../InteractionBar/FeedInteractionBar'
import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import TaskEstimation from '../../Tags/TaskEstimation'
import TaskRecurrence from '../../Tags/TaskRecurrence'
import TaskSubTasks from '../../Tags/TaskSubTasks'
import SocialText from '../../UIControls/SocialText/SocialText'
import ObjectHeaderParser from '../TextParser/ObjectHeaderParser'
import ObjectLinkTag from '../Utils/ObjectLinkTag'
import { getTagCommentsPrivacyData, goToFeedSource } from '../Utils/HelperFunctions'
import TasksHelper, {
    GENERIC_CHAT_TYPE,
    GENERIC_COMMENT_TYPE,
    OPEN_STEP,
    RECURRENCE_NEVER,
} from '../../TaskListView/Utils/TasksHelper'
import Backend from '../../../utils/BackendBridge'
import SharedHelper from '../../../utils/SharedHelper'
import PrivacyTag from '../../Tags/PrivacyTag'
import { FEED_TASK_OBJECT_TYPE } from '../Utils/FeedsConstants'
import NavigationService from '../../../utils/NavigationService'
import Swipeable from 'react-native-gesture-handler/Swipeable'
import { getWorkstreamInProject } from '../../Workstreams/WorkstreamHelper'
import { useSelector } from 'react-redux'
import useGetMessages from '../../../hooks/Chats/useGetMessages'
import TaskCommentsWrapper from '../../Tags/TaskCommentsWrapper'
import useBacklinks from '../../../hooks/useBacklinks'
import { LINKED_OBJECT_TYPE_TASK } from '../../../utils/LinkingHelper'
import BacklinksTag from '../../Tags/BacklinksTag'
import { RECURRENCE_MAP } from '../../TaskListView/Utils/TasksHelper'

const TaskObjectHeader = ({ projectId, feed, isLocked }) => {
    const loggedUser = useSelector(state => state.loggedUser)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const activeModalInFeed = useSelector(state => state.activeModalInFeed)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const [blockOpen, setBlockOpen] = useState(false)
    const [panColor, setPanColor] = useState(new Animated.Value(0))
    const [showInteractionBar, setShowInteractionBar] = useState(false)
    const [task, setTask] = useState(null)
    const itemSwipe = useRef()

    const {
        assigneeEstimation,
        recurrence,
        parentId,
        parentName,
        // comments,
        taskId,
        privacy,
        subtaskIds,
        genericData,
        userId,
        isDone,
        inWorkflow,
        isDeleted,
        name,
        linkBack,
        type,
        assistantId,
    } = feed

    const isOutOfOpen = !task || task.userIds.length > 1 || task.inDone

    const messages = useGetMessages(false, false, projectId, taskId, 'tasks')

    const { backlinksTasksCount, backlinkTaskObject, backlinksNotesCount, backlinkNoteObject } = useBacklinks(
        projectId,
        LINKED_OBJECT_TYPE_TASK,
        'linkedParentTasksIds',
        taskId
    )

    const backlinksCount = backlinksTasksCount + backlinksNotesCount
    const backlinkObject =
        backlinksCount === 1 ? (backlinksTasksCount === 1 ? backlinkTaskObject : backlinkNoteObject) : null

    useEffect(() => {
        const path = `items/${projectId}/tasks/${feed.taskId}`
        const watchId = `feedTask${feed.taskId}`
        Backend.watchObjectLTag('task', path, watchId, taskData => {
            setTask(taskData)
        })

        return () => Backend.unwatchObjectLTag('task', path, watchId)
    }, [])

    const openInteractionBar = () => {
        setShowInteractionBar(true)
    }

    const renderLeftSwipe = (progress, dragX) => {
        setPanColor(dragX)
        return <View style={{ width: 150 }} />
    }

    const onLeftSwipe = () => {
        itemSwipe.current.close()
        goToFeedSource(NavigationService, projectId, 'task', feed.taskId)
    }

    const getStateIco = () => {
        if (parentId) {
            return isDeleted
                ? 'trash-2-Sub'
                : isDone
                ? 'square-checked-gray-Sub'
                : inWorkflow
                ? 'clock-Sub'
                : 'check-square-Sub'
        } else {
            return isDeleted ? 'trash-2' : isDone ? 'square-checked-gray' : inWorkflow ? 'clock' : 'check-square'
        }
    }

    const setTaskLikePublic = () => {
        setTask({ ...task, privacy: 'public' })
    }

    const tagList = ({ inInteractionBar, subscribeClickObserver, unsubscribeClickObserver, bgColor }) => {
        const assignee =
            TasksHelper.getUserInProject(projectId, userId) ||
            TasksHelper.getContactInProject(projectId, userId) ||
            getWorkstreamInProject(projectId, userId)

        const commentsData = getTagCommentsPrivacyData(messages)
        const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)
        const showVerticalEllipsis = TasksHelper.showWrappedTaskEllipsis(
            `social_tags_${projectId}_${taskId}`,
            `social_text_${projectId}_${taskId}`
        )

        return (
            <Animated.View
                style={[
                    localStyles.tagsContainer,
                    { backgroundColor: bgColor },
                    inInteractionBar ? { marginRight: 8 } : null,
                ]}
                nativeID={`social_tags_${projectId}_${taskId}`}
            >
                {showVerticalEllipsis && !inInteractionBar && <Text style={localStyles.verticalEllipsis}>...</Text>}

                {!inInteractionBar && !!commentsData && (
                    <TaskCommentsWrapper
                        commentsData={commentsData}
                        projectId={projectId}
                        objectId={taskId}
                        subscribeClickObserver={subscribeClickObserver}
                        unsubscribeClickObserver={unsubscribeClickObserver}
                        objectType="tasks"
                        userGettingKarmaId={userId}
                        objectName={name}
                        assistantId={assistantId}
                    />
                )}
                {!inInteractionBar && subtaskIds && subtaskIds.length > 0 && (
                    <TaskSubTasks
                        amountOfSubTasks={subtaskIds.length}
                        style={{ marginLeft: 8 }}
                        isMobile={smallScreenNavigation}
                        disabled={true}
                    />
                )}
                {!inInteractionBar && assigneeEstimation > 0 && (
                    <TaskEstimation
                        task={task}
                        projectId={projectId}
                        style={{ marginLeft: 8 }}
                        isMobile={smallScreenNavigation}
                        currentEstimation={assigneeEstimation}
                        stepId={OPEN_STEP}
                        subscribeClickObserver={subscribeClickObserver}
                        unsubscribeClickObserver={unsubscribeClickObserver}
                        disabled={!accessGranted || isOutOfOpen}
                    />
                )}
                {!inInteractionBar && task && TasksHelper.isPrivateTask(task, loggedUser, true) && (
                    <PrivacyTag
                        projectId={projectId}
                        object={task}
                        objectType={FEED_TASK_OBJECT_TYPE}
                        style={{ marginLeft: 8 }}
                        isMobile={smallScreenNavigation}
                        disabled={!task || !accessGranted}
                        callback={setTaskLikePublic}
                    />
                )}
                {!inInteractionBar && RECURRENCE_MAP[recurrence] && recurrence !== RECURRENCE_NEVER && (
                    <TaskRecurrence
                        task={task ? task : { recurrence }}
                        projectId={projectId}
                        style={{ marginLeft: 8 }}
                        isMobile={smallScreenNavigation}
                        subscribeClickObserver={subscribeClickObserver}
                        unsubscribeClickObserver={unsubscribeClickObserver}
                        disabled={!accessGranted}
                    />
                )}
                {backlinksCount > 0 && (
                    <BacklinksTag
                        object={task}
                        objectType={LINKED_OBJECT_TYPE_TASK}
                        projectId={projectId}
                        style={{ marginLeft: 8 }}
                        disabled={!accessGranted}
                        backlinksCount={backlinksCount}
                        backlinkObject={backlinkObject}
                    />
                )}
                {!inInteractionBar && parentId != null && parentId !== '' && (
                    <ObjectLinkTag
                        containerStyle={{ marginLeft: 8 }}
                        text={parentName ? parentName : 'Parent task'}
                        projectId={projectId}
                        objectTypes="tasks"
                        objectId={parentId}
                    />
                )}

                {assignee && (
                    <View style={localStyles.taskAssignee}>
                        <Image style={localStyles.taskAssigneeImage} source={assignee?.photoURL} />
                    </View>
                )}
            </Animated.View>
        )
    }

    const feedModel = ({ inInteractionBar, subscribeClickObserver, unsubscribeClickObserver, bgColor }) => {
        const stateIco = getStateIco()
        const hasLinkBack = linkBack !== undefined && linkBack.length > 0
        const packageLinkback = { id: taskId, linkBack }
        let emulatedGenericTask, isGenericComment, isGenericChat, parentLink

        if (genericData) {
            const { parentObjectId, parentType, genericType } = genericData
            emulatedGenericTask = { id: taskId, genericData, linkBack: hasLinkBack && linkBack }
            isGenericComment = genericType === GENERIC_COMMENT_TYPE
            isGenericChat = genericType === GENERIC_CHAT_TYPE
            const detailedViewTab = isGenericComment || isGenericChat ? 'chat' : 'properties'
            const objectTypePath = parentType === 'users' ? 'contacts' : parentType
            parentLink =
                parentType === 'projects'
                    ? `/project/${projectId}/${detailedViewTab}`
                    : `/projects/${projectId}/${objectTypePath}/${parentObjectId}/${detailedViewTab}`
        }

        return (
            <View
                style={[
                    localStyles.header,
                    inInteractionBar ? localStyles.expanded : null,
                    inInteractionBar && isMiddleScreen ? { paddingLeft: 7 } : null,
                ]}
                data-feed-object={`${projectId}_${taskId}`}
                pointerEvents={isLocked ? 'none' : 'auto'}
            >
                <View style={{ flexGrow: 1, flex: 1 }}>
                    <View style={{ flexDirection: 'row' }}>
                        <Icon
                            name={stateIco}
                            color={colors.Text03}
                            size={24}
                            style={{ top: inInteractionBar ? -2 : 2 }}
                        />

                        {inInteractionBar ? (
                            <ObjectHeaderParser
                                linkBack={hasLinkBack ? linkBack : undefined}
                                text={name}
                                genericLink={parentLink}
                                genericLinkToComments={isGenericComment}
                                projectId={projectId}
                            />
                        ) : (
                            <View style={localStyles.descriptionContainer}>
                                <SocialText
                                    elementId={`social_text_${projectId}_${taskId}`}
                                    style={[styles.body1, localStyles.descriptionText]}
                                    numberOfLines={3}
                                    wrapText={true}
                                    hasLinkBack={hasLinkBack}
                                    task={genericData ? emulatedGenericTask : hasLinkBack ? packageLinkback : undefined}
                                    bgColor={bgColor}
                                    projectId={projectId}
                                    onPress={e => {
                                        if (!inInteractionBar && !activeModalInFeed && !blockOpen) {
                                            openInteractionBar()
                                        }
                                    }}
                                >
                                    {hasLinkBack ? `${window.location.origin}${linkBack} ${name}` : name}
                                </SocialText>
                            </View>
                        )}
                    </View>
                </View>
                {tagList({
                    inInteractionBar,
                    subscribeClickObserver,
                    unsubscribeClickObserver,
                    bgColor,
                })}
            </View>
        )
    }

    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

    const outputColors = [colors.UtilityYellow125, '#ffffff', colors.UtilityGreen125]
    const backColor = panColor.interpolate({
        inputRange: [-100, 0, 100],
        outputRange: outputColors,
        extrapolate: 'clamp',
    })

    return showInteractionBar ? (
        <FeedInteractionBar
            FeedModel={props => feedModel(props)}
            setShowInteractionBar={value => setShowInteractionBar(value)}
            feedObjectType={type}
            projectId={projectId}
            feed={feed}
            isHeaderObject={true}
        />
    ) : (
        <View>
            <View style={localStyles.swipeContainer}>
                <View style={localStyles.leftSwipeArea}>
                    <Icon name="circle-details" size={18} color={colors.UtilityGreen200} />
                    <View style={{ marginLeft: 4 }}>
                        <Text style={[styles.subtitle2, { color: colors.UtilityGreen200 }]}>Details</Text>
                    </View>
                </View>

                <View style={localStyles.rightSwipeArea}>
                    <View style={localStyles.rightSwipeAreaContainer} />
                </View>
            </View>

            <Swipeable
                ref={itemSwipe}
                rightThreshold={80}
                leftThreshold={80}
                enabled={accessGranted && !isLocked}
                renderLeftActions={renderLeftSwipe}
                onSwipeableLeftWillOpen={onLeftSwipe}
                overshootLeft={false}
                overshootRight={false}
                friction={2}
                containerStyle={{ overflow: 'visible' }}
                failOffsetY={[-5, 5]}
                onSwipeableWillClose={() => {
                    setBlockOpen(true)
                }}
                onSwipeableClose={() => {
                    setBlockOpen(false)
                }}
            >
                <Animated.View style={[localStyles.headerSwipe, { backgroundColor: backColor }]}>
                    {feedModel({ bgColor: backColor })}
                </Animated.View>
            </Swipeable>
        </View>
    )
}

export default TaskObjectHeader

const localStyles = StyleSheet.create({
    header: {
        flexDirection: 'row',
    },
    expanded: {
        paddingVertical: 8,
        paddingLeft: 16,
        width: '100%',
        minHeight: 60,
    },
    tagsContainer: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        alignItems: 'center',
        position: 'absolute',
        right: 0,
        bottom: 4,
        paddingLeft: 8,
        backgroundColor: '#ffffff',
    },
    descriptionContainer: {
        flexGrow: 1,
        paddingLeft: 12,
        flex: 1,
    },
    descriptionText: {
        display: 'flex',
        alignItems: 'flex-start',
        maxHeight: 90,
    },
    taskAssignee: {
        flexDirection: 'row',
        marginLeft: 8,
        alignItems: 'center',
        justifyContent: 'center',
        height: 24,
    },
    taskAssigneeImage: {
        width: 24,
        height: 24,
        borderRadius: 100,
    },
    verticalEllipsis: {
        ...styles.body1,
        alignSelf: 'baseline',
        color: '#000000',
    },
    headerSwipe: {
        paddingVertical: 8,
        paddingLeft: 8,
        paddingRight: 8,
        marginLeft: -8,
        marginRight: -8,
        borderRadius: 4,
    },
    swipeContainer: {
        height: '100%',
        width: '100%',
        borderRadius: 4,
        position: 'absolute',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    leftSwipeArea: {
        flexDirection: 'row',
        alignItems: 'center',
        width: '50%',
        height: '100%',
        backgroundColor: colors.UtilityGreen100,
        borderRadius: 4,
        paddingLeft: 12,
    },
    rightSwipeAreaContainer: {
        marginLeft: 'auto',
        flexDirection: 'row',
        alignItems: 'center',
    },
    rightSwipeArea: {
        flexDirection: 'row',
        width: '50%',
        height: '100%',
        backgroundColor: colors.UtilityYellow100,
        borderRadius: 4,
        paddingRight: 12,
    },
})
