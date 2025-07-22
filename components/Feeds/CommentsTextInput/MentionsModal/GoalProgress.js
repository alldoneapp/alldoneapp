import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { em2px } from '../../../styles/global'
import { DYNAMIC_PERCENT, progressMap } from '../../../GoalsView/GoalsHelper'
import ProjectHelper from '../../../SettingsView/ProjectsSettings/ProjectHelper'
import { PROJECT_COLOR_SYSTEM } from '../../../../Themes/Modern/ProjectColors'

export default function GoalProgress({ projectId, progress, containerStyle, dynamicProgress }) {
    let { progressBorderColorInMentionModal, progressTextColorInMentionModal } = progressMap[progress]
        ? progressMap[progress]
        : progressMap[DYNAMIC_PERCENT]
    if (progress === 0) {
        const projectColor = ProjectHelper.getProjectColorById(projectId)
        progressBorderColorInMentionModal = PROJECT_COLOR_SYSTEM[projectColor].PROJECT_ITEM_SECTION_ITEM_ACTIVE
        progressTextColorInMentionModal = PROJECT_COLOR_SYSTEM[projectColor].MARKER
    }
    return (
        <View style={[localStyles.container, { borderColor: progressBorderColorInMentionModal }, containerStyle]}>
            <Text style={[localStyles.progress, { color: progressTextColorInMentionModal }]}>
                {progress === DYNAMIC_PERCENT ? dynamicProgress : progress}
            </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 20,
        width: 24,
        borderRadius: 4,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2,
    },
    progress: {
        fontFamily: 'Roboto-Medium',
        fontWeight: 'bold',
        fontSize: 11,
        lineHeight: 19,
        letterSpacing: em2px(0.03),
        marginTop: 1,
    },
})
