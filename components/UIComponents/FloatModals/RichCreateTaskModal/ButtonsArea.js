import React, { useEffect } from 'react'
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
    enterKeyAction,
    done,
}) {
    const onKeyDown = event => {
        const { key } = event
        if (key === 'Enter') enterKeyAction(event)
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
        }
    })

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
                <DoneButton enterKeyAction={enterKeyAction} done={done} disabled={disabled} />
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
