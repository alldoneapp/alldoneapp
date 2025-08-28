import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import ColoredCircleSmall from '../../../SidebarMenu/ProjectFolding/ProjectItem/ColoredCircleSmall'
import styles, { colors } from '../../../styles/global'
import ProjectBadge from './ProjectBadge'
import Icon from '../../../Icon'

export default function ProjectHeader({ project, amount, containerStyle }) {
    return (
        <View style={[localStyles.container, containerStyle]}>
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
                    <Icon size={24} name={'circle'} color={colors.Text03} />
                )}
                <Text style={localStyles.projectName} numberOfLines={1}>
                    {project.name}
                </Text>
                <Text style={localStyles.dot}>•</Text>
                <ProjectBadge value={amount} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 56,
        justifyContent: 'flex-end',
        paddingBottom: 6,
        borderBottomColor: colors.Grey400,
        borderBottomWidth: 1,
        marginHorizontal: 16,
    },
    titleContainer: {
        alignItems: 'center',
        justifyContent: 'flex-start',
        flexDirection: 'row',
    },
    projectName: {
        ...styles.subtitle1,
        paddingLeft: 8,
        color: '#ffffff',
    },
    dot: {
        ...styles.subtitle1,
        color: colors.Text03,
        marginHorizontal: 6,
    },
})
