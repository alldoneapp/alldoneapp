import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import Icon from '../../../../Icon'
import ColoredCircleSmall from '../../../../SidebarMenu/ProjectFolding/ProjectItem/ColoredCircleSmall'
import styles, { colors, hexColorToRGBa } from '../../../../styles/global'

export default function ProjectModalItem({ selectedProjectId, project, onProjectSelect }) {
    const onPress = e => {
        onProjectSelect(project.id)
    }

    const selected = selectedProjectId === project.id

    return (
        <View>
            <TouchableOpacity onPress={onPress}>
                <View style={[localStyles.container, selected && localStyles.containerSelected]}>
                    <View style={localStyles.headerContainer}>
                        <ColoredCircleSmall
                            size={16}
                            color={project.color}
                            isGuide={!!project.parentTemplateId}
                            containerStyle={{ marginRight: 12 }}
                            projectId={project.id}
                        />
                        <Text
                            numberOfLines={1}
                            style={[
                                styles.subtitle1,
                                localStyles.projectName,
                                selected && localStyles.projectNameSelected,
                            ]}
                        >
                            {project.name}
                        </Text>
                    </View>

                    {selected && (
                        <View style={[localStyles.checkContainer]}>
                            <Icon name="check" size={24} color="white" />
                        </View>
                    )}
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
    checkContainer: {
        marginLeft: 'auto',
    },
    projectName: {
        color: '#ffffff',
    },
    projectNameSelected: {
        color: colors.Primary100,
    },
})
