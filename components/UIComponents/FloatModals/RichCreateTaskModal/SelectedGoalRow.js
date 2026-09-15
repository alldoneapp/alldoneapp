import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import Icon from '../../../Icon'
import TasksHelper from '../../../TaskListView/Utils/TasksHelper'
import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

export default function SelectedGoalRow({ activeGoal, showParentGoal }) {
    if (!activeGoal) return null

    const goalName = TasksHelper.getTaskNameWithoutMeta(activeGoal.extendedName || activeGoal.name || '')

    return (
        <TouchableOpacity
            accessibilityRole="button"
            onPress={showParentGoal}
            style={localStyles.container}
            testID="selected-goal-row"
        >
            <View style={localStyles.label}>
                <Icon name="target" size={24} color={colors.Text03} />
                <Text style={localStyles.labelText}>{translate('Goal')}</Text>
            </View>
            <View style={localStyles.goalTag}>
                <Text numberOfLines={1} style={localStyles.goalName} testID="selected-goal-name">
                    {goalName}
                </Text>
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        minHeight: 40,
        marginBottom: 16,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    label: {
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 16,
    },
    labelText: {
        ...styles.subtitle1,
        color: '#ffffff',
        marginLeft: 8,
    },
    goalTag: {
        minWidth: 0,
        maxWidth: '65%',
        height: 24,
        borderRadius: 12,
        paddingHorizontal: 8,
        justifyContent: 'center',
        backgroundColor: colors.Grey300,
    },
    goalName: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
})
