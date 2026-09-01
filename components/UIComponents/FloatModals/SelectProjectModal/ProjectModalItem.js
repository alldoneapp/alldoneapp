import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import ProjectRowStatusIcon from './ProjectRowStatusIcon'
import ColoredCircleSmall from '../../../SidebarMenu/ProjectFolding/ProjectItem/ColoredCircleSmall'
import styles, { colors, hexColorToRGBa } from '../../../styles/global'

export default function ProjectModalItem({
    selectedProjectId,
    project,
    newProject,
    onProjectSelect,
    active = false,
    busy = false,
}) {
    const onPress = e => {
        onProjectSelect(e, project, newProject)
    }

    const projectId = selectedProjectId ? selectedProjectId : project.id
    return (
        <View>
            <TouchableOpacity onPress={onPress}>
                <View style={[localStyles.container, active && localStyles.containerSelected]}>
                    <View style={localStyles.headerContainer}>
                        <ColoredCircleSmall
                            size={16}
                            color={newProject.color}
                            isGuide={!!newProject.parentTemplateId}
                            containerStyle={{ marginRight: 12 }}
                            projectId={newProject.id}
                        />
                        <Text
                            numberOfLines={1}
                            style={[
                                styles.subtitle1,
                                localStyles.projectName,
                                active && localStyles.projectNameSelected,
                            ]}
                        >
                            {newProject.name}
                        </Text>
                    </View>
                    <ProjectRowStatusIcon busy={busy} checked={projectId === newProject.id} />
                </View>
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 8,
        paddingRight: 8,
    },
    containerSelected: {
        backgroundColor: hexColorToRGBa(colors.Text03, 0.16),
        borderRadius: 4,
    },
    headerContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 4,
        paddingVertical: 16,
    },
    projectName: {
        color: '#ffffff',
    },
    projectNameSelected: {
        color: colors.Primary100,
    },
})
