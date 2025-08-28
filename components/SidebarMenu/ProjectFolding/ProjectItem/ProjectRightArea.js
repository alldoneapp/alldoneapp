import React from 'react'
import { useSelector } from 'react-redux'
import { StyleSheet, View } from 'react-native'

import RightAreaAmount from './RightAreaAmount'
import ProjectRightAreaEditIcon from './ProjectRightAreaEditIcon'
import { checkIfSelectedProject } from '../../../SettingsView/ProjectsSettings/ProjectHelper'

export default function ProjectRightArea({ projectId, projectIndex, highlight }) {
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)

    return (
        <View style={localStyles.tasksAmountContainer}>
            {selectedProjectIndex === projectIndex ? (
                <ProjectRightAreaEditIcon projectIndex={projectIndex} />
            ) : !(checkIfSelectedProject(selectedProjectIndex) && highlight) ? (
                <RightAreaAmount projectId={projectId} highlight={highlight} />
            ) : null}
        </View>
    )
}

const localStyles = StyleSheet.create({
    tasksAmountContainer: {
        flexDirection: 'row',
        paddingRight: 24,
        paddingLeft: 8,
    },
})
