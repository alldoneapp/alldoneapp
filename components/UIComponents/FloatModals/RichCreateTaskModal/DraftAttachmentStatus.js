// AT-3070: the status line under the Add Task title for files attached to the draft.
//
// Files dropped on the popup stay local `blob:` words in the draft description until the task is
// submitted; only then does RichCreateTaskModal upload them (`uploadingDraft`). That upload can
// take several seconds, so it gets the same animated Spinner the task row drop zone
// (TaskFileDropZone) shows for the same text, instead of a static line that reads as done.
//
// A failed upload must not fall back to "Files added to description": the alert is gone after one
// click and the line would then claim success. It shows the failure until the next attempt.
//
// Colors: popup content keeps the light palette on the navy (light) / raised neutral (dark) card,
// so white text and the light accents read in both modes (docs/claude/dark-mode.md).

import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import Icon from '../../../Icon'
import Spinner from '../../Spinner'
import { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

export const DRAFT_ATTACHMENT_STATUS = {
    NONE: 'none',
    ATTACHED: 'attached',
    UPLOADING: 'uploading',
    FAILED: 'failed',
}

export function getDraftAttachmentStatus({ uploadingDraft, uploadFailed, description }) {
    // Uploading wins: a retry after a failure is an upload again, not a failure.
    if (uploadingDraft) return DRAFT_ATTACHMENT_STATUS.UPLOADING
    const hasLocalFiles = !!description?.includes('blob:')
    if (!hasLocalFiles) return DRAFT_ATTACHMENT_STATUS.NONE
    return uploadFailed ? DRAFT_ATTACHMENT_STATUS.FAILED : DRAFT_ATTACHMENT_STATUS.ATTACHED
}

export default function DraftAttachmentStatus({ uploadingDraft, uploadFailed, description }) {
    const status = getDraftAttachmentStatus({ uploadingDraft, uploadFailed, description })
    if (status === DRAFT_ATTACHMENT_STATUS.NONE) return null

    let indicator
    let text
    if (status === DRAFT_ATTACHMENT_STATUS.UPLOADING) {
        indicator = (
            <Spinner
                containerSize={16}
                spinnerSize={14}
                containerColor="transparent"
                spinnerColor={colors.Primary100}
            />
        )
        text = `${translate('Adding files to description')}…`
    } else if (status === DRAFT_ATTACHMENT_STATUS.FAILED) {
        indicator = <Icon name="alert-circle" size={16} color={colors.UtilityRed200} />
        text = translate('Task attachment upload failed')
    } else {
        indicator = <Icon name="paperclip" size={16} color={colors.Text04} />
        text = translate('Files added to description')
    }

    return (
        <View
            style={localStyles.container}
            testID={`draft-attachment-status-${status}`}
            accessibilityRole={status === DRAFT_ATTACHMENT_STATUS.FAILED ? 'alert' : undefined}
            accessibilityLiveRegion="polite"
            accessibilityState={{ busy: status === DRAFT_ATTACHMENT_STATUS.UPLOADING }}
        >
            <View style={localStyles.indicator}>{indicator}</View>
            <Text style={localStyles.text}>{text}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 16,
        marginBottom: 8,
    },
    indicator: {
        width: 16,
        height: 16,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
    },
    text: {
        flex: 1,
        color: '#ffffff',
        fontSize: 12,
        lineHeight: 16,
    },
})
