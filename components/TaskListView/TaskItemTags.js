import React, { useEffect, useState } from 'react'
import { Dimensions, StyleSheet, View } from 'react-native'
import TaskSummarizeTags from '../Tags/TaskSummarizeTags'
import { useSelector } from 'react-redux'
import { checkIfInMyDay } from '../MyDayView/MyDayTasks/MyDayOpenTasks/myDayOpenTasksHelper'
import Tags from './TagsArea/Tags'
import useTagsAmount from './TagsArea/useTagsAmount'
import ProjectTag from '../Tags/ProjectTag'

const TaskItemTags = ({
    task,
    isSubtask,
    projectId,
    isObservedTask,
    isToReviewTask,
    toggleSubTaskList,
    subtaskList,
    isActiveOrganizeMode,
    accessGranted,
    anonymousGranted,
    forceTagsMobile,
    setTagsExpandedHeight,
    isLocked,
    isSuggested,
    isPending,
    setExpandTags,
    expandTags,
    showSummarizeTagInByTime,
}) => {
    const showAllProjectsByTime = useSelector(state => state.loggedUser.showAllProjectsByTime)
    const route = useSelector(state => state.route)
    const selectedSidebarTab = useSelector(state => state.selectedSidebarTab)
    const taskViewToggleIndex = useSelector(state => state.taskViewToggleIndex)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const tablet = useSelector(state => state.isMiddleScreen)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const smallScreenNavSidebarCollapsed = useSelector(state => state.smallScreenNavSidebarCollapsed)
    const [visible, setVisible] = useState(false)

    const amountTags = useTagsAmount({
        task,
        isSubtask,
        projectId,
        isObservedTask,
        isToReviewTask,
        subtaskList,
        isSuggested,
        isPending,
    })

    const inMyDayAndNotSubtask =
        checkIfInMyDay(selectedProjectIndex, showAllProjectsByTime, route, selectedSidebarTab, taskViewToggleIndex) &&
        !isSubtask

    const isMobile = smallScreenNavigation || smallScreenNavSidebarCollapsed

    const needSummarize = inMyDayAndNotSubtask
        ? amountTags > 0 && showSummarizeTagInByTime
        : amountTags > 5 || (tablet && amountTags > 3) || (isMobile && amountTags > 2)

    const toggleVisibleTags = e => {
        e.preventDefault()
        e.stopPropagation()
        setTagsExpanded(!visible)
        setVisible(!visible)
        setExpandTags?.(!expandTags)
    }

    const setTagsExpanded = isVisible => {
        if (isVisible && needSummarize) {
            setTagsExpandedHeight(isSubtask ? 32 : 36)
        } else {
            setTagsExpandedHeight(0)
        }
    }

    useEffect(() => {
        setTagsExpanded(visible)
    }, [tablet, isMobile])

    useEffect(() => {
        if (!needSummarize) {
            setTagsExpandedHeight(0)
            setExpandTags?.(false)
        }
    }, [needSummarize])

    return (
        <>
            {needSummarize && (
                <View
                    style={[
                        localStyles.container,
                        visible &&
                            !inMyDayAndNotSubtask &&
                            (isSubtask ? localStyles.containerExpandSubTasks : localStyles.containerExpand),
                    ]}
                >
                    <View style={{ flexDirection: 'row' }}>
                        <TaskSummarizeTags amountTags={amountTags} onPress={toggleVisibleTags} />
                        {inMyDayAndNotSubtask && (
                            <ProjectTag
                                style={{ marginLeft: 8 }}
                                projectId={projectId}
                                disabled={isActiveOrganizeMode || isLocked || !accessGranted}
                                shrinkTextToAmountOfLetter={8}
                            />
                        )}
                    </View>
                    {visible && !inMyDayAndNotSubtask && (
                        <View style={[localStyles.tagsGroup, isSubtask && localStyles.tagsGroupSubTasks]}>
                            <Tags
                                task={task}
                                isSubtask={isSubtask}
                                projectId={projectId}
                                isObservedTask={isObservedTask}
                                isToReviewTask={isToReviewTask}
                                toggleSubTaskList={toggleSubTaskList}
                                subtaskList={subtaskList}
                                isActiveOrganizeMode={isActiveOrganizeMode}
                                accessGranted={accessGranted}
                                anonymousGranted={anonymousGranted}
                                forceTagsMobile={forceTagsMobile}
                                isLocked={isLocked}
                                isSuggested={isSuggested}
                                isPending={isPending}
                                needSummarize={needSummarize}
                            />
                        </View>
                    )}
                </View>
            )}
            {!needSummarize && (
                <Tags
                    task={task}
                    isSubtask={isSubtask}
                    projectId={projectId}
                    isObservedTask={isObservedTask}
                    isToReviewTask={isToReviewTask}
                    toggleSubTaskList={toggleSubTaskList}
                    subtaskList={subtaskList}
                    isActiveOrganizeMode={isActiveOrganizeMode}
                    accessGranted={accessGranted}
                    anonymousGranted={anonymousGranted}
                    forceTagsMobile={forceTagsMobile}
                    isLocked={isLocked}
                    isSuggested={isSuggested}
                    isPending={isPending}
                />
            )}
        </>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        flexGrow: 0,
        paddingLeft: 8,
    },
    containerExpand: {
        paddingBottom: 36,
    },
    containerExpandSubTasks: {
        paddingBottom: 32,
    },
    tagsGroup: {
        position: 'absolute',
        right: 0,
        width: Dimensions.get('screen').width - 24,
        alignContent: 'flex-end',
        justifyContent: 'flex-end',
        flexDirection: 'row',
        top: 36,
    },
    tagsGroupSubTasks: {
        top: 32,
    },
})

export default TaskItemTags
