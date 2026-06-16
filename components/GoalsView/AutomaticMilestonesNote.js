import React from 'react'
import { StyleSheet, Text } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import NavigationService from '../../utils/NavigationService'
import { setSelectedNavItem } from '../../redux/actions'
import { DV_TAB_PROJECT_PROPERTIES } from '../../utils/TabNavigationConstants'
import { checkIfSelectedAllProjects } from '../SettingsView/ProjectsSettings/ProjectHelper'
import { GOAL_MILESTONES_MODE_LINEAR, normalizeGoalMilestonesConfig } from '../../utils/GoalMilestonesHelper'

const SETTINGS_LINK_TOKEN = '__PROJECT_SETTINGS_LINK__'

export default function AutomaticMilestonesNote({ projectId, projectIndex }) {
    const dispatch = useDispatch()
    const project = useSelector(state => state.loggedUserProjectsMap[projectId])
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)

    const config = normalizeGoalMilestonesConfig(project?.goalMilestonesConfig)
    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)

    if (inAllProjects || config.mode !== GOAL_MILESTONES_MODE_LINEAR) return null

    const goToProjectSettings = () => {
        NavigationService.navigate('ProjectDetailedView', { projectIndex })
        dispatch(setSelectedNavItem(DV_TAB_PROJECT_PROPERTIES))
    }

    const fullText = translate('automatic_milestones_note', {
        count: config.futureMilestonesToCreate,
        settingsLink: SETTINGS_LINK_TOKEN,
    })
    const [beforeLink, afterLink = ''] = fullText.split(SETTINGS_LINK_TOKEN)

    return (
        <Text style={localStyles.note}>
            {beforeLink}
            <Text style={localStyles.link} onPress={goToProjectSettings}>
                {translate('project settings')}
            </Text>
            {afterLink}
        </Text>
    )
}

const localStyles = StyleSheet.create({
    note: {
        ...styles.body2,
        color: colors.Text03,
        paddingHorizontal: 8,
        marginTop: -16,
        marginBottom: 28,
    },
    link: {
        ...styles.body2,
        color: colors.Primary200,
    },
})
