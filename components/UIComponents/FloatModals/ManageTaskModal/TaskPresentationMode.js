import React from 'react'
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import SVGGenericUser from '../../../../assets/svg/SVGGenericUser'
import ObjectHeaderParser from '../../../Feeds/TextParser/ObjectHeaderParser'
import TasksHelper, { TASK_ASSIGNEE_ASSISTANT_TYPE } from '../../../TaskListView/Utils/TasksHelper'
import TaskIcon from './TaskIcon'
import { getWorkstreamById, isWorkstream } from '../../../Workstreams/WorkstreamHelper'
import { getAssistant } from '../../../AdminPanel/Assistants/assistantsHelper'

export default function TaskPresentationMode({
    projectId,
    toggleEditionMode,
    task,
    pressIcon,
    disabled,
    checkBoxMarked,
    isSubtask,
}) {
    const { extendedName, userId, id: taskId, assigneeType } = task
    const assignee =
        assigneeType === TASK_ASSIGNEE_ASSISTANT_TYPE
            ? getAssistant(userId)
            : isWorkstream(userId)
            ? getWorkstreamById(projectId, userId)
            : TasksHelper.getUserInProject(projectId, userId) || TasksHelper.getContactInProject(projectId, userId)

    const photoURL = assignee ? assignee.photoURL : ''

    const onPressIcon = () => {
        pressIcon(false)
    }

    const onLongPressIcon = () => {
        pressIcon(true)
    }

    return (
        <TouchableOpacity
            style={localStyles.container}
            onPress={toggleEditionMode}
            disabled={disabled}
            onClick={e => {
                e.stopPropagation()
            }}
        >
            <TaskIcon
                editing={true}
                task={task}
                inEditionMode={false}
                onPress={onPressIcon}
                onLongPress={onLongPressIcon}
                checkBoxMarked={checkBoxMarked}
                isSubtask={isSubtask}
                disabled={disabled}
            />
            <ObjectHeaderParser
                text={extendedName}
                projectId={projectId}
                entryExternalStyle={isSubtask ? localStyles.textSubtask : localStyles.text}
                containerExternalStyle={localStyles.textContainer}
                dotsStyle={localStyles.dotsStyle}
                disebledTags={false}
                maxHeight={24}
                shortTags={true}
            />
            {!isSubtask && (
                <View style={[localStyles.avatar, localStyles.userPhoto]}>
                    {photoURL ? (
                        <Image source={{ uri: photoURL }} style={localStyles.avatar} />
                    ) : (
                        <SVGGenericUser width={24} height={24} svgid={`ci_p_${taskId}`} />
                    )}
                </View>
            )}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: 9,
        paddingBottom: 7,
    },
    avatar: {
        width: 24,
        height: 24,
        borderRadius: 100,
    },
    userPhoto: {
        overflow: 'hidden',
    },
    text: {
        color: '#FFFFFF',
    },
    textSubtask: {
        ...styles.body2,
        color: '#FFFFFF',
        marginTop: 1,
    },
    textContainer: {
        maxHeight: 24,
        overflow: 'hidden',
        marginHorizontal: 8,
    },
    dotsStyle: {
        backgroundColor: colors.Secondary400,
    },
})
