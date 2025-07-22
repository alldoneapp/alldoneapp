import React from 'react'
import { StyleSheet, Text } from 'react-native'
import { useSelector } from 'react-redux'

import { getTheme } from '../../../../Themes/Themes'
import { Themes } from '../../Themes'
import ProjectLetter from './ProjectLetter'

export default function ColoredCircleAmount({ isGuide, projectId, projectColor }) {
    const themeName = useSelector(state => state.loggedUser.themeName)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const sidebarNumbersInProject = useSelector(state => state.sidebarNumbers[projectId])

    const theme = getTheme(Themes, themeName, 'CustomSideMenu.ProjectList.ProjectItem.ProjectItemIcon')

    const amountOpenTasks = sidebarNumbersInProject
        ? sidebarNumbersInProject[loggedUserId] > 0
            ? sidebarNumbersInProject[loggedUserId]
            : ''
        : ''

    return amountOpenTasks ? (
        <Text style={[localStyles.amountTasks, { color: theme.markerText(projectColor) }]}>{amountOpenTasks}</Text>
    ) : isGuide ? (
        <ProjectLetter fontSize={16} />
    ) : null
}

const localStyles = StyleSheet.create({
    amountTasks: {
        fontFamily: 'Roboto-Regular',
        fontWeight: 'bold',
        fontSize: 10,
        lineHeight: 10,
    },
})
