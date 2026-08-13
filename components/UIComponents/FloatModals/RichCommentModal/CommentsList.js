import React from 'react'
import { StyleSheet, View } from 'react-native'

import Comment from '../../../Feeds/FeedsModals/ListCommentsComponents/Comment'
import { getLinkedEmailFromMessage } from '../../../ChatsView/ChatDV/linkedEmailActions'
import VmInteractionCard from '../../../ChatsView/ChatDV/EditorView/VmInteractionCard'
import {
    isAwaitingVmInteraction,
    resolveEffectiveMessageLoading,
} from '../../../ChatsView/ChatDV/EditorView/messageLoadingState'
import AssistantProgress from '../../../ChatsView/ChatDV/EditorView/AssistantProgress'
import StopAssistantRunButton from '../../../ChatsView/ChatDV/EditorView/StopAssistantRunButton'
import { getTimestampInMilliseconds } from '../../../ChatsView/Utils/messageTimestamps'

export default function CommentsList({
    projectId,
    objectType,
    objectId,
    comments,
    newEmailCommentIds = new Set(),
    canArchiveLinkedEmails,
    archivingAllEmails,
    archivingEmailKeys,
    archivedEmailKeys,
    onArchiveLinkedEmail,
}) {
    return (
        <View>
            {comments.map((item, index) => {
                const linkedEmail = getLinkedEmailFromMessage(item, { projectId, chatId: objectId })
                const showVmInteraction = isAwaitingVmInteraction(item.assistantRun)
                // Same stale-spinner rule as the full chat view, so the popup cannot
                // offer a Stop button (or a progress story) for a run that timed out.
                const effectiveIsLoading = resolveEffectiveMessageLoading(
                    item,
                    getTimestampInMilliseconds(item.lastChangeDate)
                )
                const showAssistantProgress =
                    effectiveIsLoading &&
                    item.assistantRun?.kind === 'chat' &&
                    ['running', 'cancel_requested'].includes(item.assistantRun?.status)
                return (
                    <React.Fragment key={item.id}>
                        <Comment
                            comment={item}
                            projectId={projectId}
                            linkedEmail={linkedEmail}
                            linkedEmailGmailData={item.gmailData}
                            linkedEmailNew={newEmailCommentIds.has(item.id)}
                            canArchiveLinkedEmail={canArchiveLinkedEmails}
                            linkedEmailArchiving={archivingAllEmails || archivingEmailKeys.includes(linkedEmail?.key)}
                            linkedEmailArchived={archivedEmailKeys.includes(linkedEmail?.key)}
                            onArchiveLinkedEmail={onArchiveLinkedEmail}
                            contentOverride={
                                showAssistantProgress ? (
                                    <AssistantProgress
                                        activity={item.assistantRun?.activity}
                                        compact={true}
                                        appearance="dark"
                                    />
                                ) : null
                            }
                            containerStyle={{
                                marginBottom: showVmInteraction
                                    ? 0
                                    : index === 0 && comments.length > 1
                                      ? 16
                                      : index > 0 && comments.length > 2
                                        ? 8
                                        : 0,
                            }}
                        />
                        {showVmInteraction && (
                            <VmInteractionCard
                                projectId={projectId}
                                objectType={objectType}
                                objectId={objectId}
                                commentId={item.id}
                                assistantRun={item.assistantRun}
                            />
                        )}
                        {/* Same control, state and callable as the full chat view, so a run
                            can be stopped from wherever the comment is shown. It renders
                            nothing unless the run is actually stoppable. */}
                        <StopAssistantRunButton
                            projectId={projectId}
                            objectType={objectType}
                            objectId={objectId}
                            commentId={item.id}
                            assistantRun={item.assistantRun}
                            isLoading={effectiveIsLoading}
                            appearance="dark"
                            // Popup-only breathing room: in the modal the button is the last
                            // thing in its comment block and would otherwise sit flush against
                            // the next comment or the "open chat" row. The full chat view keeps
                            // the component's own spacing.
                            style={localStyles.stopButton}
                        />
                    </React.Fragment>
                )
            })}
        </View>
    )
}

const localStyles = StyleSheet.create({
    stopButton: {
        marginBottom: 8,
    },
})
