import React from 'react'
import { View } from 'react-native'

import Comment from '../../../Feeds/FeedsModals/ListCommentsComponents/Comment'
import { getLinkedEmailFromMessage } from '../../../ChatsView/ChatDV/linkedEmailActions'
import VmInteractionCard from '../../../ChatsView/ChatDV/EditorView/VmInteractionCard'
import { isAwaitingVmInteraction } from '../../../ChatsView/ChatDV/EditorView/messageLoadingState'

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
                const linkedEmail = getLinkedEmailFromMessage(item)
                const showVmInteraction = isAwaitingVmInteraction(item.assistantRun)
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
                    </React.Fragment>
                )
            })}
        </View>
    )
}
