import React from 'react'
import { useSelector } from 'react-redux'
import { View, Text, StyleSheet } from 'react-native'
import { isEqual } from 'lodash'

import ProjectList from './ProjectList'
import { PROJECT_TYPE_GUIDE } from '../SettingsView/ProjectsSettings/ProjectsSettings'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { getTheme } from '../../Themes/Themes'
import { Themes } from './Themes'
import { translate } from '../../i18n/TranslationService'
import styles from '../styles/global'
import Icon from '../Icon'
import useCollapsibleSidebar from './Collapsible/UseCollapsibleSidebar'

export default function GuideProjectsListUsers({ navigation }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const loggedUserProjectsData = useSelector(
        state =>
            state.loggedUserProjects.map(project => {
                const { id, name, color, index, globalAssistantIds, sortIndexByUser } = project
                return { id, name, color, index, globalAssistantIds, sortIndexByUser }
            }),
        isEqual
    )

    const guideProjects = ProjectHelper.sortProjects(
        ProjectHelper.getTemplateProjectsInList(loggedUserProjectsData, loggedUser.guideProjectIds),
        loggedUser.uid
    )

    const { expanded } = useCollapsibleSidebar()

    const theme = getTheme(Themes, loggedUser.themeName, 'CustomSideMenu.GuideProjects')

    if (guideProjects.length === 0) return null

    return (
        <View>
            <View style={[localStyles.titleContainer, !expanded ? { paddingLeft: 18 } : null]}>
                {expanded ? (
                    <Text style={[localStyles.text, theme.text]}>{translate('Community Projects')}</Text>
                ) : (
                    <Icon name={'map'} color={theme.text.color} size={20} />
                )}
            </View>
            <ProjectList projectsData={guideProjects} projectType={PROJECT_TYPE_GUIDE} navigation={navigation} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    titleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 32,
        paddingLeft: 24,
        paddingBottom: 4,
        marginTop: 32,
        alignItems: 'center',
    },
    text: {
        ...styles.body1,
    },
})
