import React from 'react'
import { StyleSheet, View } from 'react-native'

import DueDate from './DueDate'
import Privacy from './Privacy'
import DoneButton from './DoneButton'
import ParentGoal from './ParentGoal'
import MoreOptions from './MoreOptions'
import Recurring from './Recurring'

export default function ButtonsArea({
    projectId,
    task,
    showDueDate,
    showPrivacy,
    showParentGoal,
    showMoreOptions,
    showRecurring,
    done,
}) {
    // Enter is handled once, by TaskEditForm's document listener. This area used
    // to register a second identical listener, so a single Return ran the whole
    // creation twice.
    const { name, isPrivate, parentGoalId } = task
    const disabled = name.trim() === ''

    return (
        <View style={localStyles.buttonsContainer}>
            <View style={localStyles.buttonsLeft}>
                <DueDate showDueDate={showDueDate} disabled={disabled} />
                <Privacy isPrivate={isPrivate} showPrivacy={showPrivacy} disabled={disabled} />
                <ParentGoal parentGoalId={parentGoalId} showParentGoal={showParentGoal} disabled={disabled} />
                <Recurring showRecurring={showRecurring} disabled={disabled} />
                <MoreOptions showMoreOptions={showMoreOptions} disabled={disabled} />
            </View>
            <View style={localStyles.buttonsRight}>
                <DoneButton done={done} disabled={disabled} />
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
