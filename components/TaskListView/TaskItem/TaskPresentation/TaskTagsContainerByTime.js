import React, { useEffect, useState } from 'react'
import { Animated, StyleSheet, View, TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'

import TaskItemTags from '../../TaskItemTags'
import TimeTagWrapper from '../../../Tags/TimeTagWrapper'
import CompletedTimeTag from '../../../Tags/CompletedTimeTag'
import CalendarTag from '../../../Tags/CalendarTag'
import AlertTag from '../../../Tags/AlertTag'
import Tags from '../../TagsArea/Tags'
import { shouldOnPressInput } from '../../Utils/TasksHelper'

export default function TaskTagsContainerByTime({
    task,
    projectId,
    isObservedTask,
    isToReviewTask,
    toggleSubTaskList,
    subtaskList,
    isSuggested,
    isActiveOrganizeMode,
    isPending,
    isLocked,
    highlightColor,
    anonymousGranted,
    accessGranted,
    taskTagsSection,
    forceTagsMobile,
    setTagsExpandedHeight,
    toggleModal,
    blockOpen,
    onAlertTagPress,
}) {
    const [showSummarizeTag, setShowSummarizeTag] = useState(false)
    const [widthInFullArea, setWidthInFullArea] = useState(0)
    const [widthInLeftArea, setWidthInLeftArea] = useState(0)
    const [widthInRightArea, setWidthInRightArea] = useState(0)
    const [expandTags, setExpandTags] = useState(false)
    const taskViewToggleSection = useSelector(state => state.taskViewToggleSection)
    const inOpenSection = taskViewToggleSection === 'Open'

    const onLayoutInExpandedTagsArea = e => {
        setTagsExpandedHeight(e.nativeEvent.layout.height)
    }

    const onLayoutInFullArea = e => {
        if (!showSummarizeTag) setWidthInFullArea(e.nativeEvent.layout.width)
    }

    const onLayoutInLeftArea = e => {
        if (!showSummarizeTag) setWidthInLeftArea(e.nativeEvent.layout.width)
    }

    const onLayoutInRightArea = e => {
        if (!showSummarizeTag) setWidthInRightArea(e.nativeEvent.layout.width)
    }

    useEffect(() => {
        if (!showSummarizeTag && widthInFullArea && widthInLeftArea && widthInRightArea) {
            if (widthInLeftArea + widthInRightArea > widthInFullArea) {
                setShowSummarizeTag(true)
            }
        }
    }, [showSummarizeTag, widthInFullArea, widthInLeftArea, widthInRightArea])

    return (
        <Animated.View style={[localStyles.taskTags, { backgroundColor: highlightColor }]}>
            <TouchableOpacity
                onPress={e => {
                    if (toggleModal && shouldOnPressInput(e, blockOpen)) toggleModal(e)
                }}
            >
                <View
                    ref={taskTagsSection}
                    onLayout={onLayoutInFullArea}
                    style={localStyles.innerTaskTags}
                    nativeID={`social_tags_${projectId}_${task.id}`}
                >
                    <View onLayout={onLayoutInLeftArea}>
                        {task &&
                            console.log('[TaskTagsContainerByTime] Task:', task.id, 'alertEnabled:', task.alertEnabled)}
                        {task && task.alertEnabled && (
                            <AlertTag task={task} containerStyle={{ marginRight: 8 }} onPress={onAlertTagPress} />
                        )}
                        {task && task.time && !task.calendarData && (
                            <TimeTagWrapper projectId={projectId} task={task} />
                        )}
                        {task && task.calendarData && !task.completedTime && (
                            <CalendarTag calendarData={task.calendarData} containerStyle={{ marginRight: 8 }} />
                        )}
                        {!inOpenSection && task && task.completedTime && <CompletedTimeTag task={task} />}
                    </View>
                    <View onLayout={onLayoutInRightArea} style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <TaskItemTags
                            task={task}
                            projectId={projectId}
                            isObservedTask={isObservedTask}
                            isToReviewTask={isToReviewTask}
                            isSuggested={isSuggested}
                            toggleSubTaskList={toggleSubTaskList}
                            subtaskList={subtaskList}
                            isActiveOrganizeMode={isActiveOrganizeMode}
                            accessGranted={accessGranted}
                            anonymousGranted={anonymousGranted}
                            forceTagsMobile={forceTagsMobile}
                            setTagsExpandedHeight={setTagsExpandedHeight}
                            isLocked={isLocked}
                            isPending={isPending}
                            setExpandTags={setExpandTags}
                            expandTags={expandTags}
                            showSummarizeTagInByTime={showSummarizeTag}
                        />
                    </View>
                </View>
                {expandTags && (
                    <View style={localStyles.tagsGroup} onLayout={onLayoutInExpandedTagsArea}>
                        <Tags
                            task={task}
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
                            needSummarize={true}
                            tagsStyle={{ marginLeft: 0, marginRight: 8, marginBottom: 5 }}
                        />
                    </View>
                )}
            </TouchableOpacity>
        </Animated.View>
    )
}

const localStyles = StyleSheet.create({
    taskTags: {
        position: 'absolute',
        right: 0,
        left: 44,
        top: 3,
    },
    innerTaskTags: {
        marginTop: 5,
        marginBottom: 5,
        paddingRight: 8,
        alignItems: 'flex-start',
        flexDirection: 'row',
        justifyContent: 'space-between',
        width: '100%',
    },
    innerSubtasksTags: {
        marginTop: 6,
        marginBottom: 6,
    },
    tagsGroup: {
        alignContent: 'flex-end',
        justifyContent: 'flex-end',
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
})
