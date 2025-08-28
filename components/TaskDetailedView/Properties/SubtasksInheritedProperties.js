import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import AssignedTo from './AssignedTo'
import DueDate from './DueDate'
import Project from './Project'
import Workflow from './Workflow'
import Recurring from './Recurring'
import ParentGoal from './ParentGoal'
import { FEED_PUBLIC_FOR_ALL } from '../../Feeds/Utils/FeedsConstants'

export default function SubtasksInheritedProperties({ project, task, loggedUserCanUpdateObject }) {
    const smallScreen = useSelector(state => state.smallScreen)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const projectId = project.id
    const isGuide = !!project.parentTemplateId
    return (
        <View style={[localStyles.container, smallScreen ? null : localStyles.panelsContainer]}>
            <View style={[localStyles.columnContainer, smallScreen ? null : localStyles.leftContainer]}>
                <AssignedTo projectId={projectId} task={task} disabled={isGuide} />
                <DueDate projectId={projectId} task={task} disabled={!loggedUserCanUpdateObject} />
                <Project item={{ type: 'task', data: task }} project={project} />
            </View>
            <View style={[localStyles.columnContainer, smallScreen ? null : localStyles.rightContainer]}>
                <Workflow projectId={projectId} task={task} disabled={!loggedUserCanUpdateObject} />
                <Recurring projectId={projectId} task={task} disabled={!loggedUserCanUpdateObject} />
                <ParentGoal
                    projectId={projectId}
                    task={
                        !task.parentGoalIsPublicFor ||
                        task.parentGoalIsPublicFor.includes(FEED_PUBLIC_FOR_ALL) ||
                        task.parentGoalIsPublicFor.includes(loggedUserId)
                            ? task
                            : { ...task, parentGoalId: null, parentGoalIsPublicFor: null }
                    }
                    disabled={!loggedUserCanUpdateObject}
                />
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
