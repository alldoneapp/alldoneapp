import React from 'react'
import { FlatList, View } from 'react-native'
import { useSelector } from 'react-redux'

import ProjectItem from './ProjectFolding/ProjectItem/ProjectItem'
import { checkIfSelectedProject } from '../SettingsView/ProjectsSettings/ProjectHelper'

export default function ProjectList({ projectsData, projectType, navigation, isShared }) {
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)

    const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)

    return (
        <View>
            <FlatList
                extraData={[inSelectedProject]}
                data={projectsData}
                keyExtractor={item => item.id}
                renderItem={projectDataItem => {
                    const { item: projectData, index: itemIndex } = projectDataItem
                    const shortcutIndex = itemIndex + 1
                    return (
                        projectData.name.trim().length > 0 && (
                            <ProjectItem
                                projectData={projectData}
                                projectType={projectType}
                                navigation={navigation}
                                isShared={isShared}
                                shortcutIndex={shortcutIndex}
                                itemIndex={itemIndex}
                            />
                        )
                    )
                }}
                showsVerticalScrollIndicator={false}
            />
        </View>
    )
}
