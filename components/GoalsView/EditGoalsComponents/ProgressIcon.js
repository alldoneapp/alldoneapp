import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { PROJECT_COLOR_SYSTEM } from '../../../Themes/Modern/ProjectColors'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'

import styles from '../../styles/global'
import { DYNAMIC_PERCENT, progressMap } from '../GoalsHelper'

export default function ProgressIcon({ projectId, progress, inGoal, dynamicProgress }) {
    let { progressTextColor, progressBorderColor } = progressMap[progress]
        ? progressMap[progress]
        : progressMap[DYNAMIC_PERCENT]
    if (inGoal && progress === 0) {
        const projectColor = ProjectHelper.getProjectColorById(projectId)
        progressBorderColor = PROJECT_COLOR_SYSTEM[projectColor].PROJECT_ITEM_SECTION_ITEM_ACTIVE
        progressTextColor = PROJECT_COLOR_SYSTEM[projectColor].MARKER
    }
    return (
        <View style={[localStyles.container, { borderColor: progressBorderColor }]}>
            <Text style={[localStyles.text, { color: progressTextColor }]}>{`${
                progress === DYNAMIC_PERCENT ? dynamicProgress : progress
            }%`}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderRadius: 12,
        borderWidth: 2,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    text: {
        ...styles.subtitle2,
        paddingHorizontal: 5,
    },
})
