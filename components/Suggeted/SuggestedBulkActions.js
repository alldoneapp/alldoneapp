import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import Button from '../UIControls/Button'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { showConfirmPopup } from '../../redux/actions'
import { CONFIRM_POPUP_TRIGGER_REJECT_ALL_SUGGESTED_TASKS } from '../UIComponents/ConfirmPopup'
import { acceptAllSuggestedTasks } from '../../utils/suggestedTaskBulkActions'
import { isAssistantSuggestedTask } from '../../utils/suggestedTaskFlow'

// "Accept all" / "Reject all" for a whole "Suggested by X" section (AT-2173).
//
// Shown whenever the section holds at least one suggestion. These used to appear only from two
// upwards, on the assumption that the per-task checkbox popup (SuggestedModal) was enough below
// that — but a section that sometimes carries the actions and sometimes not reads as a bug, and
// single-suggestion sections (a lone calendar suggestion, say) are the common case. Only a section
// with nothing left to act on hides them.
export const MIN_TASKS_FOR_BULK_ACTIONS = 1

export default function SuggestedBulkActions({ projectId, tasks, containerStyle }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const workflow = useSelector(state => state.currentUser?.workflow?.[projectId])
    const [processing, setProcessing] = useState(false)

    const suggestedTasks = Array.isArray(tasks) ? tasks.filter(task => task?.id) : []

    if (suggestedTasks.length < MIN_TASKS_FOR_BULK_ACTIONS) return null

    // A section only ever groups one suggester, so the whole section shares the single-task
    // wording: an assistant suggestion is "rejected", a human one moves to the next step.
    const isRejection = suggestedTasks.every(isAssistantSuggestedTask)
    const rejectTitleKey = isRejection ? 'Reject all' : 'Next step for all'
    // ...and the icon follows that wording, the same way the single-task button does. A rejection
    // is not a workflow move, so the workflow glyph misread as "workflow" — especially on mobile,
    // where the button is icon-only and the label can't disambiguate it (AT-2210).
    const rejectIcon = isRejection ? 'x' : 'next-workflow'

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
                    headerText: isRejection ? 'Reject all suggested tasks' : 'Next step for all',
                    // The button keeps its "all" label at any count, but the confirmation is a
                    // sentence: "1 suggested tasks will be rejected" reads broken in all three
                    // languages, so a section of one gets its own singular phrasing.
                    headerQuestion:
                        suggestedTasks.length === 1
                            ? 'Reject single suggested task question'
                            : 'Reject all suggested tasks question',
                    headerQuestionParams: { count: suggestedTasks.length },
                },
            })
        )
    }

    const buttonStyle = smallScreenNavigation ? [localStyles.button, localStyles.buttonMobile] : localStyles.button

    return (
        <View style={[localStyles.container, containerStyle]}>
            <Button
                type={'ghost'}
                noBorder={true}
                icon={rejectIcon}
                iconSize={COMPACT_ICON_SIZE}
                iconGap={COMPACT_ICON_GAP}
                title={smallScreenNavigation ? null : translate(rejectTitleKey)}
                titleStyle={localStyles.rejectTitle}
                iconColor={colors.Text03}
                buttonStyle={buttonStyle}
                onPress={onRejectAll}
                disabled={processing}
                // Icon-only on mobile: the label is the only accessible name, so the button has to
                // opt into the accessibility tree (Button defaults `accessible` to false).
                accessible={smallScreenNavigation}
                accessibilityLabel={translate(rejectTitleKey)}
            />
            <Button
                type={'ghost'}
                noBorder={true}
                icon={'check'}
                iconSize={COMPACT_ICON_SIZE}
                iconGap={COMPACT_ICON_GAP}
                title={smallScreenNavigation ? null : translate('Accept all')}
                titleStyle={localStyles.acceptTitle}
                iconColor={colors.Primary100}
                buttonStyle={buttonStyle}
                onPress={onAcceptAll}
                disabled={processing}
                accessible={smallScreenNavigation}
                accessibilityLabel={translate('Accept all')}
            />
        </View>
    )
}

// Sized off the auto-postpone button in the Task Filters ("Priority") line — see
// `AutoPostponeButton` in components/TaskListView/PriorityFilters/TaskFiltersLine.js: a 12px icon
// with a caption-sized label, 4px apart, on a chrome-less row-height button. These bulk actions used
// the default 40px bordered button, which made the "Suggested by X" header read like a form footer
// (AT-2223).
const COMPACT_ICON_SIZE = 12
const COMPACT_ICON_GAP = 4
const COMPACT_BUTTON_HEIGHT = 24

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 8,
    },
    button: {
        // Button's master style pins all three, so a shorter button has to override all three.
        height: COMPACT_BUTTON_HEIGHT,
        minHeight: COMPACT_BUTTON_HEIGHT,
        maxHeight: COMPACT_BUTTON_HEIGHT,
        marginLeft: 8,
        paddingVertical: 0,
        paddingLeft: 4,
        paddingRight: 4,
        backgroundColor: 'transparent',
    },
    // Icon-only on mobile: a square keeps the tap target at the button height instead of letting
    // the padding collapse around a 12px glyph.
    buttonMobile: {
        width: COMPACT_BUTTON_HEIGHT,
        paddingLeft: 0,
        paddingRight: 0,
    },
    // caption1's metrics (the label of the row these buttons sit in), not the 14px button text.
    // Kept as static styles so the ref stays stable across renders.
    rejectTitle: {
        ...styles.caption1,
        lineHeight: 16,
        color: colors.Text03,
    },
    acceptTitle: {
        ...styles.caption1,
        lineHeight: 16,
        color: colors.Primary100,
    },
})
