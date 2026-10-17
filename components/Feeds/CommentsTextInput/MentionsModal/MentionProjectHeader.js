import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import ColoredCircleSmall from '../../../SidebarMenu/ProjectFolding/ProjectItem/ColoredCircleSmall'
import styles, { colors } from '../../../styles/global'

export default function MentionProjectHeader({ project, amount }) {
    return (
        <View style={localStyles.headerContainer}>
            <View style={localStyles.titleContainer}>
                {project.color ? (
                    <ColoredCircleSmall
                        size={16}
                        color={project.color}
                        isGuide={!!project.parentTemplateId}
                        containerStyle={{ marginHorizontal: 4 }}
                        projectId={project.id}
                    />
                ) : (
                    <View style={[localStyles.colorDot, { backgroundColor: colors.Text03 }]} />
                )}
                <Text style={localStyles.projectName} numberOfLines={1}>
                    {project.name}
                </Text>
                <Text style={localStyles.dot}>•</Text>
                <View style={localStyles.badge}>
                    <Text style={localStyles.badgeText}>{amount}</Text>
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    headerContainer: {
        height: 40,
        justifyContent: 'flex-end',
        paddingBottom: 4,
        borderBottomColor: colors.Grey400,
        borderBottomWidth: 1,
        marginTop: 8,
    },
    titleContainer: {
        alignItems: 'center',
        justifyContent: 'flex-start',
        flexDirection: 'row',
    },
    colorDot: {
        width: 16,
        height: 16,
        borderRadius: 8,
        marginHorizontal: 4,
    },
    projectName: {
        ...styles.subtitle2,
        paddingLeft: 8,
        color: '#ffffff',
        flex: 1,
    },
    dot: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginHorizontal: 6,
    },
    badge: {
        backgroundColor: colors.Primary200,
        borderRadius: 10,
        paddingHorizontal: 6,
        paddingVertical: 2,
        minWidth: 20,
        alignItems: 'center',
    },
    badgeText: {
        ...styles.caption2,
        color: colors.Text03,
    },
})
