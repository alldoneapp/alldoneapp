import React, { useEffect } from 'react'

import ChatInput from './ChatInput'
import DismissibleItem from '../../../UIComponents/DismissibleItem'
import { useDispatch, useSelector } from 'react-redux'
import { setActiveChatMessageId } from '../../../../redux/actions'
import MessageItemBody from './MessageItemBody'

export default function MessageItemContent({
    messageId,
    creatorId,
    projectId,
    commentText,
    chatTitle,
    members,
    chat,
    dismissibleRef,
    creatorData,
    objectType,
    setAmountOfNewCommentsToHighligth,
    isLoading,
    assistantRun,
    linkedEmail,
    linkedEmailGmailData,
    linkedEmailArchiving,
    linkedEmailArchived,
    onArchiveLinkedEmail,
    canArchiveLinkedEmail,
}) {
    const dispatch = useDispatch()
    const activeChatMessageId = useSelector(state => state.activeChatMessageId)

    const closeEditMode = () => {
        dismissibleRef.current.closeModal()
    }

    useEffect(() => {
        if (dismissibleRef.current.modalIsVisible() && activeChatMessageId !== messageId) {
            closeEditMode()
        }
    }, [activeChatMessageId])

    return (
        <DismissibleItem
            ref={dismissibleRef}
            defaultComponent={
                // The message body itself lives in MessageItemBody so the chat list's unread
                // previews (AT-2256) can render it without dragging edit mode along.
                <MessageItemBody
                    messageId={messageId}
                    projectId={projectId}
                    commentText={commentText}
                    chat={chat}
                    creatorData={creatorData}
                    objectType={objectType}
                    isLoading={isLoading}
                    assistantRun={assistantRun}
                    linkedEmail={linkedEmail}
                    linkedEmailGmailData={linkedEmailGmailData}
                    linkedEmailArchiving={linkedEmailArchiving}
                    linkedEmailArchived={linkedEmailArchived}
                    onArchiveLinkedEmail={onArchiveLinkedEmail}
                    canArchiveLinkedEmail={canArchiveLinkedEmail}
                />
            }
            modalComponent={
                <ChatInput
                    chat={chat}
                    projectId={projectId}
                    chatTitle={chatTitle}
                    members={members}
                    containerStyle={{
                        bottom: undefined,
                        left: undefined,
                        right: undefined,
                        marginRight: 16,
                        marginTop: 8,
                    }}
                    initialText={commentText}
                    editing={true}
                    messageId={messageId}
                    closeEditMode={closeEditMode}
                    creatorId={creatorId}
                    creatorData={creatorData}
                    objectType={objectType}
                    setAmountOfNewCommentsToHighligth={setAmountOfNewCommentsToHighligth}
                />
            }
            onToggleModal={visable => {
                console.log('[ChatEditDebug] message edit modal toggled', {
                    messageId,
                    visible: visable,
                    activeChatMessageId,
                })
                if (!visable) dispatch(setActiveChatMessageId(''))
            }}
        />
    )
}
