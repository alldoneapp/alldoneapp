import React, { useEffect, useState } from 'react'
import { StyleSheet, View, Text } from 'react-native'
import { useSelector } from 'react-redux'

import { getAssistantLineData, getCommentData } from './AssistantOptions/helper'
import { ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY } from '../../../utils/backends/Chats/chatsComments'
import LastComment from './LastComment/LastComment'
import PendingAssistantComment from './LastComment/PendingAssistantComment'
import { translate } from '../../../i18n/TranslationService'
import { colors } from '../../styles/global'
import { LastCommentPreviewSkeleton } from './AssistantLineSkeleton'
import {
    assistantHasRepliedToPendingSend,
    resolveAssistantLineSendForChat,
    useAssistantLinePendingSend,
} from './assistantLinePendingSend'

export default function LastCommentArea({
    withTopMargin = true,
    useCardBackground = false,
    useAssistantProjectContext = true,
    useGlobalLatestComment = false,
    compact = false,
    projectOverride = null,
    assistantIdOverride = null,
    preferAssistantIdOverride = false,
    scopeToAssistant = false,
}) {
    const defaultAssistantId = useSelector(state => state.defaultAssistant.uid)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const selectedProjectFromStore = useSelector(state => state.loggedUserProjects[selectedProjectIndex])
    const selectedProject = projectOverride || selectedProjectFromStore
    const defaultProjectId = useSelector(state => state.loggedUser.defaultProjectId)
    const assistantId = assistantIdOverride || defaultAssistantId
    const { assistantProject, assistantProjectId } = getAssistantLineData(
        selectedProject,
        assistantId,
        defaultProjectId,
        preferAssistantIdOverride
    )
    const project = useAssistantProjectContext ? assistantProject || selectedProject : selectedProject
    const projectKey = useGlobalLatestComment
        ? ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY
        : useAssistantProjectContext
          ? assistantProjectId || project?.id || ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY
          : project?.id || ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY
    const lastAssistantCommentData = useSelector(state =>
        scopeToAssistant
            ? state.loggedUser.lastAssistantCommentDataByAssistant?.[assistantId]?.[projectKey]
            : state.loggedUser.lastAssistantCommentData?.[projectKey]
    )
    const projectChatLastNotification = useSelector(state =>
        scopeToAssistant ? null : state.projectChatLastNotification[projectKey]
    )
    const followedProjectChatLastNotification = projectChatLastNotification?.followed
        ? projectChatLastNotification
        : null
    // AT-2511 — identifies THIS Last comment slot for arrival detection. It has to outlive the
    // subtree (a comment arriving in another chat remounts it, and so does the AT-2504 pending →
    // reply handoff), so the memory is keyed on the slot rather than held in a component. The user
    // is part of it so an account switch cannot inherit the previous user's "already seen", and the
    // assistant is part of it only when the slot is scoped to one, matching `projectKey` above.
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const scopeKey = `${loggedUserId || ''}:${projectKey}:${scopeToAssistant ? assistantId || '' : ''}`

    const [aModalIsOpen, setAModalIsOpen] = useState(false)
    const [currentProjectChatLastNotification, setCurrentProjectChatLastNotification] = useState(
        followedProjectChatLastNotification
    )
    const [currentLastAssistantCommentData, setCurrentLastAssistantCommentData] = useState(lastAssistantCommentData)

    useEffect(() => {
        if (!aModalIsOpen) {
            setCurrentProjectChatLastNotification(followedProjectChatLastNotification)
            setCurrentLastAssistantCommentData(lastAssistantCommentData)
        }
    }, [aModalIsOpen, followedProjectChatLastNotification, lastAssistantCommentData])

    // AT-2504 — a message submitted through the assistant line clears the composer immediately and
    // finishes in the background, so this slot is where the user finds out that it is still going.
    const pendingSend = useAssistantLinePendingSend(projectKey, scopeToAssistant ? assistantId : null)

    // Ending the wait needs no listener of its own: the two pointers this component already
    // subscribes to both move when the assistant posts. `lastAssistantCommentData` carries
    // `creatorType: 'assistant'` (the client stamps `'user'` for our OWN comment, which lands
    // first and must not count), and a followed chat notification for that chat can only have been
    // produced by somebody else, since the comment fan-out excludes its own creator.
    useEffect(() => {
        if (!pendingSend?.chatId) return

        const assistantReplied =
            assistantHasRepliedToPendingSend(pendingSend, lastAssistantCommentData) ||
            followedProjectChatLastNotification?.chatId === pendingSend.chatId

        if (assistantReplied) resolveAssistantLineSendForChat(pendingSend.chatId)
    }, [pendingSend, lastAssistantCommentData, followedProjectChatLastNotification])

    const { commentCreator, commentProject } = getCommentData(
        project,
        currentProjectChatLastNotification,
        currentLastAssistantCommentData,
        assistantId,
        defaultProjectId
    )

    // Ahead of every other branch on purpose. The two below both render "there is nothing here
    // yet" — `null` on an assistant board with no history, the ghost while the pointer loads — and
    // a message the user sent two seconds ago is precisely when both of those are wrong.
    if (pendingSend) {
        return (
            <View
                style={[
                    localStyles.container,
                    compact && localStyles.compactContainer,
                    !compact && withTopMargin && localStyles.containerWithTopMargin,
                    !compact && useCardBackground && localStyles.cardContainer,
                ]}
            >
                {!compact && <Text style={localStyles.title}>{translate('Last comment')}</Text>}
                <View style={compact ? null : localStyles.previewInset}>
                    <PendingAssistantComment
                        pending={pendingSend}
                        assistantName={pendingSend.assistantName}
                        compact={compact}
                    />
                </View>
            </View>
        )
    }

    if (scopeToAssistant && !currentLastAssistantCommentData) {
        return null
    }

    if (!commentProject || !commentCreator) {
        if (compact) return null

        return (
            <View
                style={[
                    localStyles.container,
                    withTopMargin && localStyles.containerWithTopMargin,
                    useCardBackground && localStyles.cardContainer,
                ]}
            >
                <Text style={localStyles.title}>{translate('Last comment')}</Text>
                <View style={localStyles.previewInset}>
                    <LastCommentPreviewSkeleton />
                </View>
            </View>
        )
    }

    return (
        <View
            style={[
                localStyles.container,
                compact && localStyles.compactContainer,
                !compact && withTopMargin && localStyles.containerWithTopMargin,
                !compact && useCardBackground && localStyles.cardContainer,
            ]}
        >
            {!compact && <Text style={localStyles.title}>{translate('Last comment')}</Text>}
            <LastComment
                project={commentProject}
                assistant={commentCreator}
                setAModalIsOpen={setAModalIsOpen}
                currentProjectChatLastNotification={currentProjectChatLastNotification}
                currentLastAssistantCommentData={currentLastAssistantCommentData}
                compact={compact}
                scopeKey={scopeKey}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
    },
    compactContainer: {
        width: 'auto',
        maxWidth: '100%',
        alignItems: 'flex-end',
    },
    containerWithTopMargin: {
        marginTop: 24,
    },
    cardContainer: {
        backgroundColor: colors.Grey200,
        borderRadius: 4,
        paddingLeft: 10,
        paddingRight: 16,
        paddingTop: 14,
        paddingBottom: 12,
    },
    title: {
        fontSize: 13,
        fontWeight: '600',
        color: colors.Text03,
        marginBottom: 8,
        textAlign: 'center',
    },
    previewInset: {
        marginLeft: 16,
    },
})
