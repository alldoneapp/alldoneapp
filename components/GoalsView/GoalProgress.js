import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { PROJECT_COLOR_SYSTEM } from '../../Themes/Modern/ProjectColors'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'

import styles from '../styles/global'
import { DYNAMIC_PERCENT, progressMap } from './GoalsHelper'

import { alphaColor, modeColor, resolveColor } from '../../Themes/colorMode'

export default function GoalProgress({ projectId, openModal, progress, disabled, dynamicProgress }) {
    let { progressBorderColor, progressTextColor } = progressMap[progress]
        ? progressMap[progress]
        : progressMap[DYNAMIC_PERCENT]
    if (progress === 0) {
        const projectColor = ProjectHelper.getProjectColorById(projectId)
        const { PROJECT_ITEM_SECTION_ITEM_ACTIVE, MARKER } = PROJECT_COLOR_SYSTEM[projectColor]
        // In dark mode the light pastel border becomes a dark tint the size of the row behind it,
        // so the box read as an empty hole. Draw the border from the project colour instead.
        progressBorderColor = modeColor(
            resolveColor(PROJECT_ITEM_SECTION_ITEM_ACTIVE, 'light'),
            alphaColor(resolveColor(MARKER, 'light'), 0.6)
        )
        progressTextColor = MARKER
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
        // White in light mode; in dark mode the box sits on its row instead of a darker hole.
        backgroundColor: modeColor('#FFFFFF', 'transparent'),
    },
})
