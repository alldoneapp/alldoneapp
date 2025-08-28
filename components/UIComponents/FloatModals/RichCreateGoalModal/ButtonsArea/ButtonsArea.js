import React from 'react'
import { StyleSheet, View } from 'react-native'

import DateRange from './DateRange'
import Privacy from './Privacy'
import DoneButton from './DoneButton'
import AssigneesButton from './AssigneesButton'
import HighlightButton from './HighlightButton'
import DescriptionButton from './DescriptionButton'

export default function ButtonsArea({
    projectId,
    goal,
    showDateRange,
    showPrivacy,
    showAssignees,
    showDescription,
    showHighlight,
    enterKeyAction,
    createGoal,
}) {
    const { name, isPublicFor, assigneesIds, hasStar } = goal
    const disabled = name.trim() === ''

    return (
        <View style={localStyles.buttonsContainer}>
            <View style={localStyles.buttonsLeft}>
                <DateRange showDateRange={showDateRange} disabled={disabled} />
                <Privacy isPublicFor={isPublicFor} showPrivacy={showPrivacy} disabled={disabled} />
                <AssigneesButton
                    projectId={projectId}
                    showAssignees={showAssignees}
                    assigneesIds={assigneesIds}
                    disabled={disabled}
                />
                <HighlightButton showHighlight={showHighlight} disabled={disabled} hasStar={hasStar} />
                <DescriptionButton showDescription={showDescription} disabled={disabled} />
            </View>
            <View style={localStyles.buttonsRight}>
                <DoneButton enterKeyAction={enterKeyAction} onPress={createGoal} disabled={disabled} />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    buttonsContainer: {
        flexDirection: 'row',
        backgroundColor: '#162764',
        paddingVertical: 8,
        paddingHorizontal: 8,
    },
    buttonsLeft: {
        flexDirection: 'row',
        flex: 1,
    },
})
