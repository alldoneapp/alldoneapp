import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import ProjectTagIndicator from './ProjectTagIndicator'
import LastCommentText from './LastCommentText'
import { PREVIEW_BODY_HEIGHT, PREVIEW_TITLE_HEIGHT } from './lastCommentLayout'

/**
 * AT-2511 — one comment, laid out inside the Last comment card. Extracted from
 * `LastAssistantComment` so the card can render it TWICE: the comment rolling away and the one
 * rolling in are the same component with different props, which is what makes the ticker a
 * five-line animation rather than a DOM-snapshotting exercise.
 *
 * It carries the card's former padding, because the card itself no longer has any — the roll is
 * clipped by a viewport that fills the card's whole box, so the padding has to live on the rows
 * inside it.
 *
 * AT-2902 — the project tag leads the title line and the topic name starts right after it,
 * truncated to one line, instead of the tag sitting in the card's top-right corner over the end
 * of the topic name.
 *
 * Purely presentational: no motion, no arrival state, no press handling. The card owns all three.
 */
const LastCommentRow = ({ projectId, commentText, objectName, compact = false }) => {
    if (compact) {
        return (
            <>
                <Icon name={'message-circle'} color={colors.Text03} size={14} />
                <LastCommentText projectId={projectId} commentText={commentText} compact />
            </>
        )
    }

    return (
        <>
            <Icon name={'message-circle'} color={colors.Text03} size={16} style={localStyles.icon} />
            <View style={localStyles.textContainer}>
                <View style={localStyles.titleRow} testID="last-comment-title-row">
                    <ProjectTagIndicator projectId={projectId} />
                    {!!objectName && (
                        <Text numberOfLines={1} style={localStyles.title}>
                            {objectName}
                        </Text>
                    )}
                </View>
                <View style={localStyles.parsedTextContainer}>
                    {/*
                     * AT-2872 — the preview shows the END of the comment. The clip grows with its
                     * content up to the body height, so a short comment still sits at the top, and
                     * bottom-aligns what it holds, so an overflowing one is cut at the TOP and the
                     * last lines stay visible.
                     */}
                    <View style={localStyles.tailClip} testID="last-comment-tail-clip">
                        <LastCommentText projectId={projectId} commentText={commentText} fromEnd />
                    </View>
                </View>
            </View>
        </>
    )
}

export default LastCommentRow

// Lives in `lastCommentLayout` since AT-2523 so the card shell can lay a row out without importing
// this module's comment/tag/navigation graph. Re-exported here because this is where it was.
export { rowStyles } from './lastCommentLayout'

const localStyles = StyleSheet.create({
    textContainer: {
        width: '100%',
        paddingRight: 20,
        justifyContent: 'flex-start',
    },
    titleRow: {
        // Reserved even when the chat has no title, so the body text never shifts upwards.
        height: PREVIEW_TITLE_HEIGHT,
        flexShrink: 0,
        flexDirection: 'row',
        alignItems: 'center',
        // Not clipped: the 24px project tag is centred on this 22px line and overhangs it by a
        // pixel on each side, inside the card's 12px padding. The title truncates on its own.
    },
    title: {
        ...styles.subtitle2,
        color: colors.Text03,
        fontWeight: 'bold',
        flexShrink: 1,
        minWidth: 0,
    },
    parsedTextContainer: {
        height: PREVIEW_BODY_HEIGHT,
        flexShrink: 0,
        overflow: 'hidden',
    },
    tailClip: {
        maxHeight: PREVIEW_BODY_HEIGHT,
        overflow: 'hidden',
        justifyContent: 'flex-end',
    },
    icon: {
        marginTop: 4,
        marginRight: 4,
    },
})
