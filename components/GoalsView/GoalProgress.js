import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { PROJECT_COLOR_SYSTEM } from '../../Themes/Modern/ProjectColors'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'

import styles from '../styles/global'
import { DYNAMIC_PERCENT, progressMap } from './GoalsHelper'

export default function GoalProgress({ projectId, openModal, progress, disabled, dynamicProgress }) {
    let { progressBorderColor, progressTextColor } = progressMap[progress]
        ? progressMap[progress]
        : progressMap[DYNAMIC_PERCENT]
    if (progress === 0) {
        const projectColor = ProjectHelper.getProjectColorById(projectId)
        progressBorderColor = PROJECT_COLOR_SYSTEM[projectColor].PROJECT_ITEM_SECTION_ITEM_ACTIVE
        progressTextColor = PROJECT_COLOR_SYSTEM[projectColor].MARKER
    }

    return (
        <TouchableOpacity
            style={[localStyles.container, { borderColor: progressBorderColor }]}
            onPress={openModal}
            disabled={disabled}
        >
            <Text style={[styles.subtitle1, { color: progressTextColor }]}>
                {progress === DYNAMIC_PERCENT ? dynamicProgress : progress}%
            </Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 32,
        width: 52,
        borderRadius: 4,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
        backgroundColor: '#ffffff',
    },
})
