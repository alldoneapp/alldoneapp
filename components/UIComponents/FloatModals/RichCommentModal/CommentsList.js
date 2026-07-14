import React from 'react'
import { View } from 'react-native'

import Comment from '../../../Feeds/FeedsModals/ListCommentsComponents/Comment'
import { getLinkedEmailFromMessage } from '../../../ChatsView/ChatDV/linkedEmailActions'

export default function CommentsList({
    projectId,
    comments,
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
                return (
                    <Comment
                        key={item.id}
                        comment={item}
                        projectId={projectId}
                        linkedEmail={linkedEmail}
                        linkedEmailGmailData={item.gmailData}
                        canArchiveLinkedEmail={canArchiveLinkedEmails}
                        linkedEmailArchiving={archivingAllEmails || archivingEmailKeys.includes(linkedEmail?.key)}
                        linkedEmailArchived={archivedEmailKeys.includes(linkedEmail?.key)}
                        onArchiveLinkedEmail={onArchiveLinkedEmail}
                        containerStyle={{
                            marginBottom:
                                index === 0 && comments.length > 1 ? 16 : index > 0 && comments.length > 2 ? 8 : 0,
                        }}
                    />
                )
            })}
        </View>
    )
}
