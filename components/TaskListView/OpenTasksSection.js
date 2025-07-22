import React from 'react'
import { View } from 'react-native'
import { useSelector } from 'react-redux'

import OpenTasksViewSelectedProject from './OpenTasksView/OpenTasksViewSelectedProject'
import { checkIfSelectedAllProjects } from '../SettingsView/ProjectsSettings/ProjectHelper'
import OpenTasksViewAllProjects from './OpenTasksView/OpenTasksViewAllProjects'

export default function OpenTasksSection() {
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)

    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)

    return (
        <View style={{ flex: 1 }}>
            {inAllProjects ? <OpenTasksViewAllProjects /> : <OpenTasksViewSelectedProject />}
        </View>
    )
}
