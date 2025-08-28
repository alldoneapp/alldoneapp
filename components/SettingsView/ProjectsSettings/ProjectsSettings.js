import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import ProjectsSettingsHeader from './ProjectsSettingsHeader'
import ProjectHelper from './ProjectHelper'
import URLsSettings, {
    URL_SETTINGS_PROJECTS,
    URL_SETTINGS_PROJECTS_ARCHIVED,
    URL_SETTINGS_PROJECTS_GUIDE,
} from '../../../URLSystem/Settings/URLsSettings'
import NothingToShow from '../../UIComponents/NothingToShow'
import { setActiveDragProjectModeType, setProjectTypeSectionIndex } from '../../../redux/actions'
import useActiveProjectDragMode from './Sorting/useActiveProjectDragMode'
import DroppableList from './Sorting/DroppableList'
import ProjectsList from './ProjectsList'

export const PROJECT_TYPE_ACTIVE = 'active'
export const PROJECT_TYPE_ARCHIVED = 'archived'
export const PROJECT_TYPE_TEMPLATE = 'template'
export const PROJECT_TYPE_GUIDE = 'guide'

export const PROJECT_TYPE_SHARED = 'shared'

export default function ProjectsSettings({}) {
    const dispatch = useDispatch()
    const loggedUser = useSelector(state => state.loggedUser)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const projectTypeSectionIndex = useSelector(state => state.projectTypeSectionIndex)

    const type =
        projectTypeSectionIndex === 0
            ? PROJECT_TYPE_ACTIVE
            : projectTypeSectionIndex === 1
            ? PROJECT_TYPE_GUIDE
            : PROJECT_TYPE_ARCHIVED

    const activeDragMode = useActiveProjectDragMode(type)

    const writeBrowserURL = () => {
        switch (type) {
            case PROJECT_TYPE_ACTIVE:
                return URLsSettings.push(URL_SETTINGS_PROJECTS)
            case PROJECT_TYPE_ARCHIVED:
                return URLsSettings.push(URL_SETTINGS_PROJECTS_ARCHIVED)
            case PROJECT_TYPE_GUIDE:
                return URLsSettings.push(URL_SETTINGS_PROJECTS_GUIDE)
        }
    }

    const filterProjectsByType = () => {
        let filtered = ProjectHelper.getProjectsByType2(loggedUserProjects, type, loggedUser)
        return ProjectHelper.sortProjects(filtered, loggedUser.uid)
    }

    const filteredProjects = filterProjectsByType()

    useEffect(() => {
        writeBrowserURL()
    }, [type])

    useEffect(() => {
        return () => {
            dispatch(setProjectTypeSectionIndex(0))
        }
    }, [])

    useEffect(() => {
        return () => {
            dispatch(setActiveDragProjectModeType(null))
        }
    }, [type])

    return (
        <View style={localStyles.container}>
            <ProjectsSettingsHeader amount={filteredProjects.length} projectType={type} />

            {activeDragMode ? (
                <DroppableList projects={filteredProjects} projectType={type} />
            ) : filteredProjects.length > 0 ? (
                <ProjectsList projects={filteredProjects} />
            ) : (
                <NothingToShow />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
    },
})
