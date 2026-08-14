import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useSelector } from 'react-redux'

import global, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'
import { cancelAssistantRun } from '../../../../utils/backends/Assistants/assistantRuns'
import {
    clearStopRequestForRun,
    isStopRequestedForRun,
    markStopRequestedForRun,
    subscribeToStopRequests,
} from './stopAssistantRunRequests'

// A run is stoppable only while it is genuinely live and owned by the viewer.
//
// `isLoading` must already be the *effective* loading state (see
// resolveEffectiveMessageLoading) so a stale five-minute-old spinner never offers a
// Stop button for a run nobody is going to cancel. `status === 'running'` deliberately
// excludes `awaiting_user` (the VmInteractionCard owns that decision with its own
// Cancel) and `cancel_requested`/terminal states, so the button disappears by itself as
// soon as the comment doc updates.
export const canStopAssistantRun = ({ assistantRun, objectId, loggedUserId, isLoading }) =>
    !!(
        isLoading &&
        assistantRun?.status === 'running' &&
        assistantRun?.runId &&
        assistantRun?.kind &&
        objectId &&
        (!assistantRun.requestUserId || assistantRun.requestUserId === loggedUserId)
    )

const STOP_REQUEST_KEEPS_PENDING_STATUSES = ['running', 'cancel_requested']

/**
 * The single Stop control for a running assistant/VM run.
 *
 * Rendered by the full chat view (MessageItemContent) and by the comment popup
 * (RichCommentModal → CommentsList), which means the same run can own two live buttons
 * at once. Duplicate protection therefore lives in a runId-keyed module registry rather
 * than in local state — see stopAssistantRunRequests.js.
 *
 * Callers can render this unconditionally: it returns null when the run is not
 * stoppable.
 */
export default function StopAssistantRunButton({
    projectId,
    objectType,
    objectId,
    commentId,
    assistantRun,
    isLoading,
    appearance = 'light',
    style,
}) {
    const loggedUserId = useSelector(state => state.loggedUser?.uid)
    const runId = assistantRun?.runId
    const runStatus = assistantRun?.status
    const [stopRequested, setStopRequested] = useState(() => isStopRequestedForRun(runId))

    useEffect(() => {
        const sync = () => setStopRequested(isStopRequestedForRun(runId))
        sync()
        return subscribeToStopRequests(sync)
    }, [runId])

    // Once the backend has settled the run, forget the request so a recycled surface
    // can never render a permanently disabled "Stopping…" button.
    useEffect(() => {
        if (runStatus && !STOP_REQUEST_KEEPS_PENDING_STATUSES.includes(runStatus)) {
            clearStopRequestForRun(runId)
        }
    }, [runId, runStatus])

    const stoppable = canStopAssistantRun({ assistantRun, objectId, loggedUserId, isLoading })

    const stopAssistantRun = async () => {
        // markStopRequestedForRun is the claim: it returns false when this run already
        // has a stop request in flight from this surface or any other one, which is what
        // keeps a double tap (or a second mounted button) from firing two callables.
        if (!stoppable || !markStopRequestedForRun(runId)) return
        try {
            await cancelAssistantRun({
                projectId,
                objectType,
                objectId,
                commentId,
                runKind: assistantRun.kind,
                runId,
            })
        } catch (error) {
            clearStopRequestForRun(runId)
            console.error('Failed to stop assistant run', error)
            alert(translate('Could not stop assistant', { error: error.message }))
        }
    }

    if (!stoppable) return null

    const darkAppearance = appearance === 'dark'
    const contentColor = darkAppearance ? colors.UtilityRed125 : colors.UtilityRed200

    return (
        <TouchableOpacity
            style={[
                localStyles.stopRunButton,
                darkAppearance && localStyles.stopRunButtonDark,
                stopRequested && localStyles.stopRunButtonDisabled,
                style,
            ]}
            onPress={stopAssistantRun}
            disabled={stopRequested}
            accessibilityLabel={translate('Stop assistant')}
            testID="stop-assistant-run"
        >
            <Icon name="x-thicker" size={10} color={contentColor} />
            <Text style={[localStyles.stopRunButtonText, { color: contentColor }]}>
                {stopRequested ? translate('Stopping assistant') : translate('Stop')}
            </Text>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    stopRunButton: {
        alignSelf: 'flex-start',
        marginTop: 8,
        minHeight: 24,
        paddingHorizontal: 8,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.UtilityRed200,
        flexDirection: 'row',
        alignItems: 'center',
    },
    stopRunButtonDark: {
        borderColor: colors.UtilityRed125,
    },
    stopRunButtonDisabled: {
        opacity: 0.6,
    },
    stopRunButtonText: {
        ...global.caption2,
        marginLeft: 4,
    },
})
