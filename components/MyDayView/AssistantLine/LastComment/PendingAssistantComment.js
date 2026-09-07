import React from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'
import { useReducedMotion } from '../../../UIComponents/Ghosts/ghostAnimation'
import { cleanTextMetaData, removeFormatTagsFromText } from '../../../../functions/Utils/parseTextUtils'
import { PENDING_SEND_AWAITING_REPLY, PENDING_SEND_FAILED } from '../assistantLinePendingSend'
import LastCommentRollCard from './LastCommentRollCard'
import { LAST_COMMENT_ROW_PENDING } from './lastCommentSlotRow'
import { PREVIEW_BODY_HEIGHT, PREVIEW_TITLE_HEIGHT } from './lastCommentLayout'

/**
 * AT-2504 — what the Last comment slot shows between "the user pressed Enter" and "the assistant
 * answered".
 *
 * It is deliberately the SAME card as `LastAssistantComment`: since AT-2523 that is literal —
 * both render `LastCommentRollCard`, so they share the fixed `LAST_COMMENT_PREVIEW_HEIGHT`, the
 * clipping viewport, the press target and the ticker roll, and a change to one cannot miss the
 * other. A differently shaped placeholder would make the line jump twice — once when the
 * placeholder appears and again when the real preview replaces it — which is the reflow that fixed
 * height was introduced to prevent in the first place.
 *
 * It echoes the text that was just submitted rather than showing a bare skeleton, because the
 * composer emptied itself the instant the user hit Enter (that is the point of AT-2504) and this
 * card is now the only place that says WHAT went off. `AssistantProgress` — the rich rotating
 * "thinking" widget from the Chat DV — is deliberately not reused: its trail alone is 72px against
 * this card's 90px total, so it cannot fit without changing the line's geometry.
 *
 * ## AT-2523 — it moves, and it is a door
 *
 * Two things it never was. It **rolls in** on the same 420ms ticker as a real arriving comment, and
 * the comment it replaces rolls out under it (`lastCommentSlotRow.js` is what remembers that row
 * across the mount boundary) — so pressing Enter now reads as the slot being taken over, not as a
 * card blinking into place. And it is **pressable**: tapping it opens the thread the message went
 * into, exactly as tapping a real last comment does.
 *
 * The `opening` state is the answer to "what if the topic does not exist yet". For roughly a second
 * after Enter there is no chat id at all — `createBotQuickTopic` is two round trips — so a tap in
 * that window is remembered rather than dropped, and this card says so. The owner
 * (`PendingAssistantCommentWrapper`) opens the thread the moment the id lands.
 */
export default function PendingAssistantComment({
    pending,
    assistantName,
    compact = false,
    onPress = null,
    opening = false,
    scopeKey = null,
}) {
    const reducedMotion = useReducedMotion()
    const awaitingReply = pending?.status === PENDING_SEND_AWAITING_REPLY
    const hasFailed = pending?.status === PENDING_SEND_FAILED

    // The composer serializes mentions, hashtags and attachments as trigger-delimited tokens; the
    // real preview strips them the same way before rendering (`LastAssistantCommentWrapper`).
    const text = cleanTextMetaData(removeFormatTagsFromText(pending?.text || ''), true, true).replace(/\s\s+/g, ' ')

    // `opening` outranks the send's own status on purpose: the user has asked for something and is
    // waiting on THAT, so the card reports the thing it is doing for them rather than the thing it
    // happens to be doing anyway.
    const statusText = hasFailed
        ? translate('assistantLineSendFailed')
        : opening
          ? translate('assistantLineOpeningThread')
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

    const body = compact ? (
        <>
            {activity}
            <Text numberOfLines={1} style={localStyles.compactText}>
                {text || statusText}
            </Text>
        </>
    ) : (
        <>
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
        </>
    )

    return (
        <LastCommentRollCard
            projectId={pending?.projectId ?? null}
            commentText={text}
            objectName={statusText}
            scopeKey={scopeKey}
            rowKind={LAST_COMMENT_ROW_PENDING}
            /*
             * The send's own id IS the arrival id. Unlike the real card — whose id is published
             * from an effect and therefore lands one commit behind the text it describes — this
             * card knows at its very first render that it is new, so the roll can start in the same
             * commit that mounts it. It is stable for the life of the send, so the status changing
             * (`sending` → `awaiting_reply` → `opening`) re-renders without re-arming.
             */
            arrivalId={pending?.id ?? null}
            compact={compact}
            onPress={onPress}
            accessibilityLabel={statusText}
            accessibilityLiveRegion="polite"
            testID="assistant-pending-send"
        >
            <View
                style={compact ? localStyles.compactContent : localStyles.content}
                testID="assistant-pending-send-content"
            >
                {body}
            </View>
        </LastCommentRollCard>
    )
}

const localStyles = StyleSheet.create({
    // The card supplies the box and the row padding; these only lay the content out inside it.
    content: {
        flex: 1,
        flexDirection: 'row',
    },
    compactContent: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
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
    compactText: {
        ...styles.subtitle2,
        color: colors.Text03,
        marginLeft: 2,
        flexShrink: 1,
    },
})
