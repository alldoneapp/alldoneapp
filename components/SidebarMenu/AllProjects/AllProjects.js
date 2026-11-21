import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { checkIfSelectedAllProjects } from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { getTheme } from '../../../Themes/Themes'
import { Themes } from '../Themes'
import AllProjectsButton from './AllProjectsButton'
import ProjectSectionList from '../ProjectFolding/ProjectSectionList'
import useAnnaAloneSidebar from '../SectionsTop/useAnnaAloneSidebar'

export default function AllProjects({ navigation }) {
    const themeName = useSelector(state => state.loggedUser.themeName)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)

    const theme = getTheme(Themes, themeName, 'CustomSideMenu')

    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)
    // AT-3121, "Anna on top": not marked while Anna is alone on screen.
    const { annaAlone } = useAnnaAloneSidebar()

    const allProjectsSectionStl = [
        localStyles.allProjectsSection,
        inAllProjects && !annaAlone && [localStyles.activeSection, theme.activeSection],
    ]

    return (
        <View style={allProjectsSectionStl}>
            <View>
                <AllProjectsButton />
                {inAllProjects && <ProjectSectionList navigation={navigation} inAllProjects />}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    allProjectsSection: {
        flex: 1,
        marginBottom: 12,
        marginTop: 8,
    },
    activeSection: {
        borderBottomWidth: 2,
    },
})
