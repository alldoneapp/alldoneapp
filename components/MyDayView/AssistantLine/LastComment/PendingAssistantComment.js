import React from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'
import { useReducedMotion } from '../../../UIComponents/Ghosts/ghostAnimation'
import { cleanTextMetaData, removeFormatTagsFromText } from '../../../../functions/Utils/parseTextUtils'
import { PENDING_SEND_AWAITING_REPLY, PENDING_SEND_FAILED } from '../assistantLinePendingSend'
import {
    LAST_COMMENT_PREVIEW_HEIGHT,
    PREVIEW_BODY_HEIGHT,
    PREVIEW_TITLE_HEIGHT,
    PREVIEW_VERTICAL_PADDING,
} from './lastCommentLayout'

/**
 * AT-2504 — what the Last comment slot shows between "the user pressed Enter" and "the assistant
 * answered".
 *
 * It is deliberately the SAME card as `LastAssistantComment`: same fixed
 * `LAST_COMMENT_PREVIEW_HEIGHT`, same background, same icon and the same two clipped body lines. A
 * differently shaped placeholder would make the line jump twice — once when the placeholder
 * appears and again when the real preview replaces it — which is the reflow that fixed height was
 * introduced to prevent in the first place.
 *
 * It echoes the text that was just submitted rather than showing a bare skeleton, because the
 * composer emptied itself the instant the user hit Enter (that is the point of AT-2504) and this
 * card is now the only place that says WHAT went off. `AssistantProgress` — the rich rotating
 * "thinking" widget from the Chat DV — is deliberately not reused: its trail alone is 72px against
 * this card's 90px total, so it cannot fit without changing the line's geometry.
 */
export default function PendingAssistantComment({ pending, assistantName, compact = false }) {
    const reducedMotion = useReducedMotion()
    const awaitingReply = pending?.status === PENDING_SEND_AWAITING_REPLY
    const hasFailed = pending?.status === PENDING_SEND_FAILED

    // The composer serializes mentions, hashtags and attachments as trigger-delimited tokens; the
    // real preview strips them the same way before rendering (`LastAssistantCommentWrapper`).
    const text = cleanTextMetaData(removeFormatTagsFromText(pending?.text || ''), true, true).replace(/\s\s+/g, ' ')

    const statusText = hasFailed
        ? translate('assistantLineSendFailed')
        : awaitingReply
          ? assistantName
              ? translate('assistantLineWorkingOnIt', { name: assistantName })
              : translate('assistantLineWorkingOnItGeneric')
          : translate('assistantLineSending')

    // Under reduced motion the spinner is replaced by a static dot rather than dropped: the row
    // still has to read as "in progress", and a bare line of text does not.
    const activity = hasFailed ? (
        <Icon name={'alert-circle'} color={colors.UtilityRed200} size={14} style={localStyles.failureIcon} />
    ) : reducedMotion ? (
        <Text style={localStyles.staticActivity} testID="assistant-pending-send-static-indicator">
            {'•'}
        </Text>
    ) : (
        <ActivityIndicator
            style={localStyles.indicator}
            size="small"
            color={colors.Primary100}
            testID="assistant-pending-send-indicator"
        />
    )

    if (compact) {
        return (
            <View
                style={localStyles.compactContainer}
                testID="assistant-pending-send"
                accessibilityLiveRegion="polite"
                accessibilityLabel={statusText}
            >
                {activity}
                <Text numberOfLines={1} style={localStyles.compactText}>
                    {text || statusText}
                </Text>
            </View>
        )
    }

    return (
        <View
            style={localStyles.container}
            testID="assistant-pending-send"
            accessibilityLiveRegion="polite"
            accessibilityLabel={statusText}
        >
            <Icon name={'message-circle'} color={colors.Text03} size={16} style={localStyles.icon} />
            <View style={localStyles.textContainer}>
                <View style={localStyles.titleRow}>
                    {activity}
                    <Text
                        numberOfLines={1}
                        style={[localStyles.title, hasFailed && localStyles.failureTitle]}
                        testID="assistant-pending-send-status"
                    >
                        {statusText}
                    </Text>
                </View>
                <View style={localStyles.bodyContainer}>
                    <Text numberOfLines={2} style={localStyles.text} testID="assistant-pending-send-text">
                        {text}
                    </Text>
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: LAST_COMMENT_PREVIEW_HEIGHT,
        flexShrink: 0,
        backgroundColor: colors.Grey300,
        borderRadius: 12,
        flexDirection: 'row',
        paddingHorizontal: 4,
        paddingVertical: PREVIEW_VERTICAL_PADDING,
    },
    icon: {
        marginTop: 4,
        marginRight: 4,
    },
    textContainer: {
        flex: 1,
        paddingRight: 20,
        justifyContent: 'flex-start',
    },
    titleRow: {
        height: PREVIEW_TITLE_HEIGHT,
        flexShrink: 0,
        flexDirection: 'row',
        alignItems: 'center',
        overflow: 'hidden',
    },
    title: {
        ...styles.subtitle2,
        color: colors.Text03,
        fontWeight: 'bold',
        flexShrink: 1,
    },
    bodyContainer: {
        height: PREVIEW_BODY_HEIGHT,
        flexShrink: 0,
        overflow: 'hidden',
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
    failureTitle: {
        color: colors.UtilityRed200,
    },
    failureIcon: {
        marginRight: 6,
    },
    indicator: {
        marginRight: 6,
        transform: [{ scale: 0.7 }],
    },
    staticActivity: {
        ...styles.subtitle2,
        color: colors.Primary100,
        marginRight: 6,
    },
    compactContainer: {
        height: 24,
        maxHeight: 24,
        borderRadius: 12,
        paddingLeft: 6,
        paddingRight: 10,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.Grey300,
        overflow: 'hidden',
        width: 'auto',
        maxWidth: '100%',
    },
    compactText: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginLeft: 2,
        flexShrink: 1,
    },
})
