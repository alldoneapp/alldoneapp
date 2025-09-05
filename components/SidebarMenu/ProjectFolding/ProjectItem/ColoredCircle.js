import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { COLORS_THEME_MODERN, getTheme } from '../../../../Themes/Themes'
import { Themes } from '../../Themes'
import useCollapsibleSidebar from '../../Collapsible/UseCollapsibleSidebar'
import ColoredCircleAmount from './ColoredCircleAmount'
import ProjectLetter from './ProjectLetter'
import { checkIfSelectedProject } from '../../../SettingsView/ProjectsSettings/ProjectHelper'

export default function ColoredCircle({ projectId, projectColor, highlight, isGuide }) {
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const themeName = useSelector(state => state.loggedUser.themeName)
    const { expanded } = useCollapsibleSidebar()

    const theme = getTheme(Themes, themeName, 'CustomSideMenu.ProjectList.ProjectItem.ProjectItemIcon')

    return (
        <View
            style={[
                localStyles.projectMarker,
                {
                    backgroundColor: theme.marker(projectColor),
                    opacity: themeName === COLORS_THEME_MODERN && !highlight ? 0.4 : 1,
                },
            ]}
        >
            {!(checkIfSelectedProject(selectedProjectIndex) && highlight) && !expanded ? (
                <ColoredCircleAmount isGuide={isGuide} projectId={projectId} projectColor={projectColor} />
            ) : isGuide ? (
                <ProjectLetter fontSize={16} />
            ) : null}
        </View>
    )
}

const localStyles = StyleSheet.create({
    projectMarker: {
        width: 22,
        height: 22,
        borderRadius: 100,
        marginRight: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
})
