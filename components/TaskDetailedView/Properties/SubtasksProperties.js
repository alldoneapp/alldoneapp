import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import Subtask from './Subtask'
import Highlight from './Highlight'
import Privacy from './Privacy'
import FollowObject from '../../Followers/FollowObject'
import { FOLLOWER_TASKS_TYPE } from '../../Followers/FollowerConstants'
import CreatedBy from './CreatedBy'
import AssistantProperty from '../../UIComponents/FloatModals/ChangeAssistantModal/AssistantProperty'

export default function SubtasksProperties({
    project,
    task,
    accessGranted,
    loggedUser,
    creator,
    loggedUserCanUpdateObject,
}) {
    const smallScreen = useSelector(state => state.smallScreen)
    const projectId = project.id
    const { id: taskId, created } = task
    const loggedUserId = loggedUser.uid
    return (
        <View style={[localStyles.container, smallScreen ? null : localStyles.panelsContainer]}>
            <View style={[localStyles.columnContainer, smallScreen ? null : localStyles.leftContainer]}>
                <Subtask projectId={projectId} task={task} disabled={!loggedUserCanUpdateObject} />
                <Highlight
                    task={task}
                    projectId={projectId}
                    loggedUserId={loggedUserId}
                    disabled={!loggedUserCanUpdateObject}
                />
                <Privacy projectId={projectId} task={task} disabled={!loggedUserCanUpdateObject} />
            </View>
            <View style={[localStyles.columnContainer, smallScreen ? null : localStyles.rightContainer]}>
                <AssistantProperty
                    projectId={projectId}
                    assistantId={task.assistantId}
                    disabled={!loggedUserCanUpdateObject}
                    objectId={task.id}
                    objectType={'tasks'}
                />
                {accessGranted && (
                    <FollowObject
                        projectId={projectId}
                        followObjectsType={FOLLOWER_TASKS_TYPE}
                        followObjectId={taskId}
                        loggedUserId={loggedUserId}
                        object={task}
                    />
                )}
                <CreatedBy createdDate={created} creator={creator} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        position: 'relative',
        zIndex: 50,
    },
    panelsContainer: {
        flexDirection: 'row',
    },
    leftContainer: {
        paddingRight: 36,
    },
    rightContainer: {
        paddingLeft: 36,
    },
    columnContainer: {
        flex: 1,
    },
})
