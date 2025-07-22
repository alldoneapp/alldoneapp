import React from 'react'
import { Text, View, StyleSheet } from 'react-native'
import { useSelector } from 'react-redux'
import { isEqual } from 'lodash'

import ProjectList from './ProjectList'
import { PROJECT_TYPE_SHARED } from '../SettingsView/ProjectsSettings/ProjectsSettings'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import styles from '../styles/global'
import { getTheme } from '../../Themes/Themes'
import { Themes } from './Themes'
import { translate } from '../../i18n/TranslationService'
import Icon from '../Icon'
import useCollapsibleSidebar from './Collapsible/UseCollapsibleSidebar'

export default function SharedProjectsList({ navigation }) {
    const selectedTypeOfProject = useSelector(state => state.selectedTypeOfProject)
    const themeName = useSelector(state => state.loggedUser.themeName)
    const projectIds = useSelector(state => state.loggedUser.projectIds)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const loggedUserProjectsData = useSelector(
        state =>
            state.loggedUserProjects.map(project => {
                const { id, name, color, index, globalAssistantIds, sortIndexByUser } = project
                return { id, name, color, index, globalAssistantIds, sortIndexByUser }
            }),
        isEqual
    )
    const { expanded } = useCollapsibleSidebar()
    const sharedProjects = ProjectHelper.getSharedProjectsInList(loggedUserProjectsData, projectIds)
    const sortedProjectsData = ProjectHelper.sortProjects(sharedProjects, loggedUserId)
    const theme = getTheme(Themes, themeName, 'CustomSideMenu.SharedProjects')

    return (
        sortedProjectsData.length > 0 &&
        selectedTypeOfProject === PROJECT_TYPE_SHARED && (
            <View style={{ marginTop: 32 }}>
                <View>
                    <View style={[localStyles.container, localStyles.containerCollapsed]}>
                        <Icon
                            size={22}
                            name={'link'}
                            color={theme.text.color}
                            style={{ marginRight: 10, opacity: theme.text.opacity }}
                        />
                        {expanded && <Text style={[localStyles.text, theme.text]}>{translate('Linked page')}</Text>}
                    </View>
                    <ProjectList projectsData={sortedProjectsData} navigation={navigation} isShared={true} />
                </View>
            </View>
        )
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingLeft: 24,
        alignItems: 'center',
        flexDirection: 'row',
        height: 56,
        justifyContent: 'flex-start',
    },
    containerCollapsed: {
        paddingLeft: 17,
    },
    text: {
        ...styles.body1,
    },
})
