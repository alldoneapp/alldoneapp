import React from 'react'
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../styles/global'
import ProjectHeaderMoreButton from '../../../SettingsView/Profile/Skills/SkillsByProject/Sorting/ProjectHeaderMoreButton'
import NavigationService from '../../../../utils/NavigationService'
import store from '../../../../redux/store'
import ColoredCircleSmall from '../../../SidebarMenu/ProjectFolding/ProjectItem/ColoredCircleSmall'
import { setSelectedNavItem } from '../../../../redux/actions'
import { DV_TAB_USER_PROFILE } from '../../../../utils/TabNavigationConstants'

export default function ProjectHeader({ projectId, containerStyle, showSkillsMoreButton }) {
    const name = useSelector(state => state.loggedUserProjectsMap[projectId].name)
    const color = useSelector(state => state.loggedUserProjectsMap[projectId].color)
    const parentTemplateId = useSelector(state => state.loggedUserProjectsMap[projectId].parentTemplateId)

    const isGuide = !!parentTemplateId

    const onPressProject = () => {
        const { loggedUser, loggedUserProjectsMap } = store.getState()
        NavigationService.navigate('UserDetailedView', {
            contact: loggedUser,
            project: loggedUserProjectsMap[projectId],
        })
        store.dispatch(setSelectedNavItem(DV_TAB_USER_PROFILE))
    }

    return (
        <View style={[localStyles.container, containerStyle]}>
            <View style={localStyles.projectNameContainer}>
                <TouchableOpacity style={{ flexDirection: 'row' }} onPress={onPressProject}>
                    <ColoredCircleSmall
                        size={16}
                        color={color}
                        isGuide={isGuide}
                        containerStyle={{ margin: 4 }}
                        projectId={projectId}
                    />
                    <Text style={[styles.subtitle1, localStyles.projectName]} numberOfLines={1}>
                        {name}
                    </Text>
                </TouchableOpacity>
                {showSkillsMoreButton && <ProjectHeaderMoreButton projectId={projectId} />}
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingHorizontal: 16,
    },
    projectNameContainer: {
        flex: 1,
        flexDirection: 'row',
        borderBottomColor: colors.Grey300,
        borderBottomWidth: 1,
        paddingBottom: 7,
        paddingTop: 24,
        marginTop: 15,
        marginBottom: 7,
        justifyContent: 'space-between',
    },
    projectName: {
        ...styles.subtitle1,
        marginLeft: 4,
        color: colors.Text01,
    },
})
