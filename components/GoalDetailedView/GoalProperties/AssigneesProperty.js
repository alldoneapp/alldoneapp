import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { isEqual } from 'lodash'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import AssigneesWrapper from '../../GoalsView/EditGoalsComponents/AssigneesWrapper'
import Backend from '../../../utils/BackendBridge'
import { translate } from '../../../i18n/TranslationService'

export default function AssigneesProperty({ goal, projectId, disabled }) {
    const { id: goalId, assigneesIds, assigneesCapacity } = goal

    const updateAssignees = (updatedAssigneesIds, updatedAssigneesCapacity) => {
        if (!isEqual(assigneesIds, updatedAssigneesIds) || !isEqual(assigneesCapacity, updatedAssigneesCapacity)) {
            Backend.updateGoalAssigneesIds(
                projectId,
                goalId,
                assigneesIds,
                updatedAssigneesIds,
                goal,
                assigneesCapacity,
                updatedAssigneesCapacity
            )
        }
    }

    return (
        <View style={localStyles.container}>
            <Icon name="users" size={24} color={colors.Text03} style={localStyles.icon} />
            <Text style={localStyles.text}>{translate('Assignees')}</Text>
            <View style={{ marginLeft: 'auto' }}>
                <AssigneesWrapper
                    goal={goal}
                    updateAssignees={updateAssignees}
                    projectId={projectId}
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
