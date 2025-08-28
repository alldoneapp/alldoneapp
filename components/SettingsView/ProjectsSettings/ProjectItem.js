import React from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { size } from 'lodash'
import { useDispatch } from 'react-redux'

import styles, { colors } from '../../styles/global'
import ProjectMembersTag from '../../Tags/ProjectMembersTag'
import NavigationService from '../../../utils/NavigationService'
import ProjectStatusModalWrapper from './ProjectItemStatusModalWrapper'
import ColoredCircleSmall from '../../SidebarMenu/ProjectFolding/ProjectItem/ColoredCircleSmall'
import { setSelectedNavItem } from '../../../redux/actions'
import { DV_TAB_PROJECT_PROPERTIES } from '../../../utils/TabNavigationConstants'
import Icon from '../../Icon'

const ProjectItem = ({ project, isDragging, activeDragMode }) => {
    const dispatch = useDispatch()

    const onPressProject = () => {
        if (activeDragMode) return
        NavigationService.navigate('ProjectDetailedView', {
            projectIndex: project.index,
        })
        dispatch(setSelectedNavItem(DV_TAB_PROJECT_PROPERTIES))
    }

    const isGuide = !!project.parentTemplateId

    return (
        <View
            style={[
                localStyles.container,
                { borderRadius: 4, backgroundColor: '#ffffff' },
                isDragging && {
                    boxShadow: `${0}px ${8}px ${16}px rgba(0,0,0,0.04), ${0}px ${4}px ${8}px rgba(0,0,0,0.04)`,
                },
            ]}
        >
            <TouchableOpacity onPress={onPressProject} style={[localStyles.container, { flex: 1, paddingRight: 4 }]}>
                <View style={localStyles.projectName}>
                    <ColoredCircleSmall
                        size={16}
                        color={project.color}
                        isGuide={!!project.parentTemplateId}
                        containerStyle={{ margin: 4 }}
                        projectId={project.id}
                    />
                    <Text style={[styles.subtitle1, localStyles.title]} numberOfLines={1}>
                        {project.name}
                    </Text>
                </View>
                <View style={localStyles.tags}>
                    <ProjectMembersTag amount={size(project.userIds)} />
                </View>
                {!isGuide && (
                    <View>
                        <ProjectStatusModalWrapper project={project} activeDragMode={activeDragMode} />
                    </View>
                )}
            </TouchableOpacity>
            {activeDragMode && (
                <View style={localStyles.sixDots}>
                    <Icon name="six-dots-vertical" size={24} color={colors.Text03} />
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 56,
        flexDirection: 'row',
        alignItems: 'center',
    },
    projectName: {
        flex: 1,
        flexDirection: 'row',
    },
    title: {
        marginLeft: 4,
        color: colors.Text01,
    },
    tags: {
        paddingRight: 12,
        flexDirection: 'row',
    },
})

export default ProjectItem
