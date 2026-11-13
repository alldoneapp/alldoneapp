import React from 'react'
import { StyleSheet, View } from 'react-native'

import GhostBlock from '../../UIComponents/Ghosts/GhostBlock'
import { useGhostPulse } from '../../UIComponents/Ghosts/ghostAnimation'
import { LAST_COMMENT_PREVIEW_HEIGHT } from './LastComment/lastCommentLayout'
import { colors } from '../../styles/global'
import { useProjectSectionLastCommentTint } from '../../TaskListView/TaskHierarchy'
import {
    ASSISTANT_COMPOSER_BOX_RESTING_HEIGHT,
    ASSISTANT_HEADER_GAP,
    ASSISTANT_HEADER_HEIGHT,
} from './assistantInputLayout'

export function LastCommentPreviewSkeleton({ compact = false }) {
    const { pulse, reducedMotion } = useGhostPulse()
    const projectLastCommentTint = useProjectSectionLastCommentTint()

    if (compact) {
        return (
            <GhostBlock
                testID="assistant-last-comment-loading-skeleton"
                style={[
                    localStyles.compactComment,
                    projectLastCommentTint && { backgroundColor: projectLastCommentTint },
                ]}
                pulse={pulse}
                reducedMotion={reducedMotion}
            />
        )
    }

    return (
        <View
            testID="assistant-last-comment-loading-skeleton"
            style={[localStyles.commentCard, projectLastCommentTint && { backgroundColor: projectLastCommentTint }]}
        >
            <GhostBlock style={localStyles.commentIcon} pulse={pulse} reducedMotion={reducedMotion} />
            <View style={localStyles.commentText}>
                <GhostBlock style={localStyles.commentTitle} pulse={pulse} reducedMotion={reducedMotion} />
                <GhostBlock style={localStyles.commentLine} pulse={pulse} reducedMotion={reducedMotion} soft />
                <GhostBlock style={localStyles.commentLineShort} pulse={pulse} reducedMotion={reducedMotion} soft />
            </View>
        </View>
    )
}

// Same geometry as the real line (AssistantOptions): the compact header, then the composer box at
// its resting two-line height, then the Last comment area. `lastCommentOnly` (AT-3034 follow-up):
// while the assistant-mode sidebar is open the line is only its Last comment card.
export default function AssistantLineSkeleton({ showLastComment = true, lastCommentOnly = false }) {
    const { pulse, reducedMotion } = useGhostPulse()

    if (lastCommentOnly) {
        return (
            <View testID="assistant-line-loading-skeleton" accessibilityRole="progressbar">
                <GhostBlock style={localStyles.lastCommentLabel} pulse={pulse} reducedMotion={reducedMotion} soft />
                <View style={localStyles.lastCommentInset}>
                    <LastCommentPreviewSkeleton />
                </View>
            </View>
        )
    }

    return (
        <View testID="assistant-line-loading-skeleton" accessibilityRole="progressbar">
            <View style={localStyles.header}>
                <GhostBlock style={localStyles.avatar} pulse={pulse} reducedMotion={reducedMotion} />
                <GhostBlock style={localStyles.headerText} pulse={pulse} reducedMotion={reducedMotion} soft />
            </View>
            <GhostBlock style={localStyles.composerBox} pulse={pulse} reducedMotion={reducedMotion} soft />
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
        height: ASSISTANT_HEADER_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: ASSISTANT_HEADER_GAP,
    },
    avatar: {
        width: ASSISTANT_HEADER_HEIGHT,
        height: ASSISTANT_HEADER_HEIGHT,
        borderRadius: 8,
        marginRight: 10,
    },
    headerText: {
        width: 220,
        maxWidth: '60%',
        height: 16,
        borderRadius: 8,
    },
    composerBox: {
        width: '100%',
        height: ASSISTANT_COMPOSER_BOX_RESTING_HEIGHT,
        borderRadius: 12,
    },
    lastCommentArea: {
        marginTop: 24,
    },
    lastCommentLabel: {
        width: 82,
        height: 16,
        borderRadius: 8,
        alignSelf: 'flex-start',
        marginLeft: 16,
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
