import React from 'react'
import { Animated, StyleSheet, View } from 'react-native'

import { colors } from '../../../styles/global'
import VerticalEllipsis from '../../VerticalEllipsis'
import TaskItemTags from '../../TaskItemTags'

export default function TaskTagsContainer({
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
    showVerticalEllipsis,
    highlightColor,
    anonymousGranted,
    accessGranted,
    taskTagsSection,
    forceTagsMobile,
    setTagsExpandedHeight,
}) {
    return (
        <Animated.View style={[localStyles.taskTags, { backgroundColor: highlightColor }]}>
            <View
                ref={taskTagsSection}
                style={[localStyles.innerTaskTags, task.isSubtask && localStyles.innerSubtasksTags]}
                nativeID={`social_tags_${projectId}_${task.id}`}
            >
                {showVerticalEllipsis && <VerticalEllipsis isSubtask={task.isSubtask} task={task} />}
                <TaskItemTags
                    task={task}
                    isSubtask={task.isSubtask}
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
                />
            </View>
        </Animated.View>
    )
}

const localStyles = StyleSheet.create({
    taskTags: {
        alignItems: 'center',
        flexDirection: 'row',
        position: 'absolute',
        right: 0,
        bottom: 3,
    },
    innerTaskTags: {
        marginTop: 5,
        marginBottom: 5,
        paddingRight: 8,
        alignItems: 'center',
        flexDirection: 'row',
    },
    innerSubtasksTags: {
        marginTop: 6,
        marginBottom: 6,
    },
})
