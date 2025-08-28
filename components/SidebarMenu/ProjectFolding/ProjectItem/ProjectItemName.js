import React from 'react'
import { StyleSheet, Text } from 'react-native'
import { useSelector } from 'react-redux'

import { getTheme } from '../../../../Themes/Themes'
import { Themes } from '../../Themes'
import styles from '../../../styles/global'
import { checkIfSelectedProject } from '../../../SettingsView/ProjectsSettings/ProjectHelper'

export default function ProjectItemName({ projectName, highlight }) {
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const themeName = useSelector(state => state.loggedUser.themeName)

    const theme = getTheme(Themes, themeName, 'CustomSideMenu.ProjectList.ProjectItem.ProjectItemName')

    return (
        <Text
            style={
                checkIfSelectedProject(selectedProjectIndex) && highlight
                    ? [localStyles.titleActive, theme.titleActive]
                    : [localStyles.title, theme.title]
            }
            numberOfLines={1}
        >
            {projectName}
        </Text>
    )
}

const localStyles = StyleSheet.create({
    title: {
        ...styles.body1,
        marginRight: 10,
    },
    titleActive: {
        ...styles.subtitle1,
        marginRight: 10,
    },
})
