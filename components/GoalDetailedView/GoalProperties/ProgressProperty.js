import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import ProgressWrapper from '../../GoalsView/EditGoalsComponents/ProgressWrapper'
import Backend from '../../../utils/BackendBridge'
import { translate } from '../../../i18n/TranslationService'

export default function ProgressProperty({ goal, projectId, disabled = false }) {
    const updateProgress = progress => {
        if (progress !== goal.progress) {
            Backend.updateGoalProgress(projectId, progress, goal)
        }
    }

    return (
        <View style={localStyles.container}>
            <Icon name="bar-chart-2-Horizontal" size={24} color={colors.Text03} style={localStyles.icon} />
            <Text style={localStyles.text}>{translate('Progress')}</Text>
            <View style={{ marginLeft: 'auto' }}>
                <ProgressWrapper
                    goal={goal}
                    updateProgress={updateProgress}
                    buttonStyle={localStyles.button}
                    inDetailedView={true}
                    disabled={disabled}
                    projectId={projectId}
                />
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
    button: {
        marginHorizontal: 0,
    },
})
