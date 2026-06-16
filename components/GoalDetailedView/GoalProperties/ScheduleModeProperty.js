import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import GoalScheduleModeTag from '../../Tags/GoalScheduleModeTag'
import { translate } from '../../../i18n/TranslationService'
import { GOAL_MILESTONES_MODE_LINEAR, normalizeGoalMilestonesConfig } from '../../../utils/GoalMilestonesHelper'

export default function ScheduleModeProperty({ goal, projectId, disabled }) {
    const project = ProjectHelper.getProjectById(projectId)
    const config = normalizeGoalMilestonesConfig(project?.goalMilestonesConfig)
    if (config.mode !== GOAL_MILESTONES_MODE_LINEAR) return null

    return (
        <View style={localStyles.container}>
            <Icon name="refresh-cw" size={24} color={colors.Text03} style={localStyles.icon} />
            <Text style={localStyles.text}>{translate('Schedule mode')}</Text>
            <View style={localStyles.tag}>
                <GoalScheduleModeTag projectId={projectId} goal={goal} disabled={disabled} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        maxHeight: 56,
        minHeight: 56,
        height: 56,
        paddingLeft: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
    icon: {
        marginRight: 8,
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
    tag: {
        marginLeft: 'auto',
    },
})
