import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import { getTheme } from '../../../../Themes/Themes'
import { Themes } from '../../Themes'
import Colors from '../../../../Themes/Colors'
import ColoredCircle from './ColoredCircle'

export default function ProjectItemIcon({ projectId, projectColor, highlight, isGuide }) {
    const themeName = useSelector(state => state.loggedUser.themeName)
    const totalFollowed = useSelector(state => state.projectChatNotifications[projectId].totalFollowed)

    const theme = getTheme(Themes, themeName, 'CustomSideMenu.ProjectList.ProjectItem.ProjectItemIcon')

    return totalFollowed > 0 && !highlight ? (
        <View style={[localStyles.projectMarker, theme.indicator]}>
            <Text style={[localStyles.indicatorText, theme.indicatorText]}>{totalFollowed}</Text>
        </View>
    ) : (
        <ColoredCircle projectId={projectId} projectColor={projectColor} highlight={highlight} isGuide={isGuide} />
    )
}

const localStyles = StyleSheet.create({
    indicatorText: {
        fontFamily: 'Roboto-Regular',
        fontWeight: 'bold',
        fontSize: 10,
        lineHeight: 10,
        color: Colors.White,
    },
    projectMarker: {
        width: 22,
        height: 22,
        borderRadius: 100,
        marginRight: 10,
        alignItems: 'center',
        justifyContent: 'center',
        letterSpacing: 0.5,
    },
})
