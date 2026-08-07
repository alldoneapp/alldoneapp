import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import Button from '../UIControls/Button'
import { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { showConfirmPopup } from '../../redux/actions'
import { CONFIRM_POPUP_TRIGGER_REJECT_ALL_SUGGESTED_TASKS } from '../UIComponents/ConfirmPopup'
import { acceptAllSuggestedTasks } from '../../utils/suggestedTaskBulkActions'
import { isAssistantSuggestedTask } from '../../utils/suggestedTaskFlow'

// "Accept all" / "Reject all" for a whole "Suggested by X" section (AT-2173).
//
// Only shown from two suggestions upwards: with a single one the per-task checkbox popup
// (SuggestedModal) is both faster and richer, so a bulk control would only add noise.
export const MIN_TASKS_FOR_BULK_ACTIONS = 2

export default function SuggestedBulkActions({ projectId, tasks, containerStyle }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const workflow = useSelector(state => state.currentUser?.workflow?.[projectId])
    const [processing, setProcessing] = useState(false)

    const suggestedTasks = Array.isArray(tasks) ? tasks.filter(task => task?.id) : []

    if (suggestedTasks.length < MIN_TASKS_FOR_BULK_ACTIONS) return null

    // A section only ever groups one suggester, so the whole section shares the single-task
    // wording: an assistant suggestion is "rejected", a human one moves to the next step.
    const rejectTitleKey = suggestedTasks.every(isAssistantSuggestedTask) ? 'Reject all' : 'Next step for all'

    const onAcceptAll = () => {
        if (processing) return
        setProcessing(true)
        try {
            acceptAllSuggestedTasks({ projectId, tasks: suggestedTasks })
        } finally {
            setProcessing(false)
        }
    }

    const onRejectAll = () => {
        if (processing) return
        dispatch(
            showConfirmPopup({
                trigger: CONFIRM_POPUP_TRIGGER_REJECT_ALL_SUGGESTED_TASKS,
                object: {
                    projectId,
                    tasks: suggestedTasks,
                    workflow,
                    headerText: rejectTitleKey === 'Reject all' ? 'Reject all suggested tasks' : 'Next step for all',
                    headerQuestion: 'Reject all suggested tasks question',
                    headerQuestionParams: { count: suggestedTasks.length },
                },
            })
        )
    }

    return (
        <View style={[localStyles.container, containerStyle]}>
            <Button
                type={'ghost'}
                icon={'next-workflow'}
                title={smallScreenNavigation ? null : translate(rejectTitleKey)}
                titleStyle={{ color: colors.Text03 }}
                iconColor={colors.Text03}
                buttonStyle={localStyles.button}
                onPress={onRejectAll}
                disabled={processing}
                // Icon-only on mobile: the label is the only accessible name, so the button has to
                // opt into the accessibility tree (Button defaults `accessible` to false).
                accessible={smallScreenNavigation}
                accessibilityLabel={translate(rejectTitleKey)}
            />
            <Button
                type={'ghost'}
                icon={'check'}
                title={smallScreenNavigation ? null : translate('Accept all')}
                titleStyle={{ color: colors.Primary100 }}
                iconColor={colors.Primary100}
                buttonStyle={localStyles.button}
                onPress={onAcceptAll}
                disabled={processing}
                accessible={smallScreenNavigation}
                accessibilityLabel={translate('Accept all')}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 8,
    },
    button: {
        marginLeft: 4,
        paddingLeft: 8,
        paddingRight: 8,
    },
})
