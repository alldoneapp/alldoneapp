import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import GhostBlock from '../../UIComponents/Ghosts/GhostBlock'
import { useGhostPulse } from '../../UIComponents/Ghosts/ghostAnimation'
import { LAST_COMMENT_PREVIEW_HEIGHT } from './LastComment/lastCommentLayout'
import { colors } from '../../styles/global'

export const ASSISTANT_OPTIONS_HEADER_HEIGHT = 19
export const ASSISTANT_OPTIONS_FIRST_ROW_HEIGHT = 56
export const ASSISTANT_QUICK_ACTIONS_MOBILE_HEIGHT = 64
export const ASSISTANT_QUICK_ACTIONS_DESKTOP_HEIGHT = 32

export function AssistantOptionButtonsSkeleton() {
    const isMobile = useSelector(state => state.smallScreenNavigation)
    const { pulse, reducedMotion } = useGhostPulse()

    return (
        <View
            testID="assistant-quick-actions-loading-skeleton"
            style={[
                localStyles.optionButtons,
                { height: isMobile ? ASSISTANT_QUICK_ACTIONS_MOBILE_HEIGHT : ASSISTANT_QUICK_ACTIONS_DESKTOP_HEIGHT },
            ]}
        >
            <GhostBlock style={localStyles.quickAction} pulse={pulse} reducedMotion={reducedMotion} />
            <GhostBlock style={localStyles.quickActionWide} pulse={pulse} reducedMotion={reducedMotion} soft />
        </View>
    )
}

export function LastCommentPreviewSkeleton({ compact = false }) {
    const { pulse, reducedMotion } = useGhostPulse()

    if (compact) {
        return (
            <GhostBlock
                testID="assistant-last-comment-loading-skeleton"
                style={localStyles.compactComment}
                pulse={pulse}
                reducedMotion={reducedMotion}
            />
        )
    }

    return (
        <View testID="assistant-last-comment-loading-skeleton" style={localStyles.commentCard}>
            <GhostBlock style={localStyles.commentIcon} pulse={pulse} reducedMotion={reducedMotion} />
            <View style={localStyles.commentText}>
                <GhostBlock style={localStyles.commentTitle} pulse={pulse} reducedMotion={reducedMotion} />
                <GhostBlock style={localStyles.commentLine} pulse={pulse} reducedMotion={reducedMotion} soft />
                <GhostBlock style={localStyles.commentLineShort} pulse={pulse} reducedMotion={reducedMotion} soft />
            </View>
        </View>
    )
}

export default function AssistantLineSkeleton({ showLastComment = true }) {
    const isMobile = useSelector(state => state.smallScreenNavigation)
    const { pulse, reducedMotion } = useGhostPulse()

    return (
        <View testID="assistant-line-loading-skeleton" accessibilityRole="progressbar">
            <GhostBlock style={localStyles.header} pulse={pulse} reducedMotion={reducedMotion} />
            <View style={localStyles.firstRow}>
                <GhostBlock style={localStyles.avatar} pulse={pulse} reducedMotion={reducedMotion} />
                <GhostBlock style={localStyles.input} pulse={pulse} reducedMotion={reducedMotion} soft />
                <GhostBlock style={localStyles.voiceButton} pulse={pulse} reducedMotion={reducedMotion} />
                <GhostBlock style={localStyles.sendButton} pulse={pulse} reducedMotion={reducedMotion} />
            </View>
            <View
                style={[
                    localStyles.quickActions,
                    {
                        height: isMobile
                            ? ASSISTANT_QUICK_ACTIONS_MOBILE_HEIGHT
                            : ASSISTANT_QUICK_ACTIONS_DESKTOP_HEIGHT,
                    },
                ]}
            >
                <GhostBlock style={localStyles.quickActionSearch} pulse={pulse} reducedMotion={reducedMotion} />
                <GhostBlock style={localStyles.quickAction} pulse={pulse} reducedMotion={reducedMotion} />
                <GhostBlock style={localStyles.quickActionWide} pulse={pulse} reducedMotion={reducedMotion} soft />
            </View>
            {showLastComment && (
                <View style={localStyles.lastCommentArea}>
                    <GhostBlock style={localStyles.lastCommentLabel} pulse={pulse} reducedMotion={reducedMotion} soft />
                    <View style={localStyles.lastCommentInset}>
                        <LastCommentPreviewSkeleton />
                    </View>
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    header: {
        width: '46%',
        height: ASSISTANT_OPTIONS_HEADER_HEIGHT,
        borderRadius: 8,
        alignSelf: 'center',
        marginBottom: 16,
    },
    firstRow: {
        height: ASSISTANT_OPTIONS_FIRST_ROW_HEIGHT,
        flexDirection: 'row',
        alignItems: 'flex-end',
        marginBottom: 12,
    },
    avatar: {
        width: 48,
        height: 48,
        borderRadius: 12,
        marginLeft: 4,
        marginRight: 20,
    },
    input: {
        flex: 1,
        height: 40,
        borderRadius: 8,
        marginRight: 12,
    },
    voiceButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        marginRight: 8,
    },
    sendButton: {
        width: 40,
        height: 40,
        borderRadius: 8,
    },
    quickActions: {
        width: '100%',
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    quickActionSearch: {
        width: 82,
        height: 24,
        borderRadius: 12,
        marginHorizontal: 8,
        marginBottom: 8,
    },
    optionButtons: {
        flex: 1,
        minWidth: 220,
        maxWidth: 260,
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    quickAction: {
        width: 112,
        height: 24,
        borderRadius: 12,
        marginHorizontal: 8,
        marginBottom: 8,
    },
    quickActionWide: {
        width: 94,
        height: 24,
        borderRadius: 12,
        marginHorizontal: 8,
        marginBottom: 8,
    },
    lastCommentArea: {
        marginTop: 24,
    },
    lastCommentLabel: {
        width: 82,
        height: 16,
        borderRadius: 8,
        alignSelf: 'center',
        marginBottom: 8,
    },
    lastCommentInset: {
        marginLeft: 16,
    },
    commentCard: {
        height: LAST_COMMENT_PREVIEW_HEIGHT,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingHorizontal: 8,
        paddingVertical: 12,
        backgroundColor: colors.Grey300,
        overflow: 'hidden',
    },
    commentIcon: {
        width: 16,
        height: 16,
        borderRadius: 8,
        marginTop: 4,
        marginRight: 8,
    },
    commentText: {
        flex: 1,
    },
    commentTitle: {
        width: '42%',
        height: 12,
        borderRadius: 6,
        marginTop: 4,
        marginBottom: 10,
    },
    commentLine: {
        width: '82%',
        height: 12,
        borderRadius: 6,
        marginBottom: 8,
    },
    commentLineShort: {
        width: '58%',
        height: 12,
        borderRadius: 6,
    },
    compactComment: {
        width: 180,
        maxWidth: '100%',
        height: 24,
        borderRadius: 12,
    },
})
