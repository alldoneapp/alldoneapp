import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { COLORS_THEME_MODERN, getTheme } from '../../../../Themes/Themes'
import { Themes } from '../../Themes'
import useCollapsibleSidebar from '../../Collapsible/UseCollapsibleSidebar'
import ColoredCircleAmount from './ColoredCircleAmount'
import ProjectLetter from './ProjectLetter'
import { checkIfSelectedProject } from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import { useIsDarkMode } from '../../../../Themes/colorMode'

// Inactive project dots are faded on the light sidebar. On a dark sidebar the same fade reads
// as a muddy dark disc, so dark mode fades them much less.
const INACTIVE_OPACITY = { light: 0.4, dark: 0.75 }

export default function ColoredCircle({ projectId, projectColor, highlight, isGuide }) {
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const themeName = useSelector(state => state.loggedUser.themeName)
    const { expanded } = useCollapsibleSidebar()
    const isDarkMode = useIsDarkMode()

    const theme = getTheme(Themes, themeName, 'CustomSideMenu.ProjectList.ProjectItem.ProjectItemIcon')

    return (
        <View
            style={[
                localStyles.projectMarker,
                {
                    backgroundColor: theme.marker(projectColor),
                    opacity:
                        themeName === COLORS_THEME_MODERN && !highlight
                            ? INACTIVE_OPACITY[isDarkMode ? 'dark' : 'light']
                            : 1,
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
