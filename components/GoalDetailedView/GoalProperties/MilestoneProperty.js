import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import Backend from '../../../utils/BackendBridge'
import DateRangeWrapper from '../../GoalsView/EditGoalsComponents/DateRangeWrapper'
import { translate } from '../../../i18n/TranslationService'

export default function MilestoneProperty({ goal, projectId, disabled }) {
    const updateDateRange = (date, rangeEdgePropertyName) => {
        if (goal[rangeEdgePropertyName] !== date) {
            Backend.updateGoalDateRange(projectId, goal, date, rangeEdgePropertyName, true)
        }
    }

    return (
        <View style={localStyles.container}>
            <Icon name="milestone-2" size={24} color={colors.Text03} style={localStyles.icon} />
            <Text style={localStyles.text}>{translate('Milestone')}</Text>
            <View style={{ marginLeft: 'auto' }}>
                <DateRangeWrapper
                    projectId={projectId}
                    updateDateRange={updateDateRange}
                    goal={goal}
                    buttonStyle={localStyles.button}
                    inDetailedView={true}
                    disabled={disabled}
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
