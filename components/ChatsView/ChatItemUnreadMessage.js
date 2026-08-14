import React from 'react'
import { StyleSheet, View } from 'react-native'

import MessageItemHeader from './ChatDV/EditorView/MessageItemHeader'
import MessageItemBody from './ChatDV/EditorView/MessageItemBody'
import useGetUserPresentationData from '../ContactsView/Utils/useGetUserPresentationData'
import { getTimestampInMilliseconds } from './Utils/ChatHelper'
import { resolveEffectiveMessageLoading } from './ChatDV/EditorView/messageLoadingState'
import { getLinkedEmailFromMessage } from './ChatDV/linkedEmailActions'

/**
 * One unread message as previewed under a topic in the chat list (AT-2256).
 *
 * Renders through the very same components the thread uses - `MessageItemHeader` for the author
 * line and `MessageItemBody` for the content - so markdown, quotes, code blocks, mentions,
 * hashtags, links, attachments and the linked-email action row look identical to the real thread
 * rather than to a second, drifting renderer.
 *
 * What it deliberately drops from `MessageItem` is everything that is an *interaction with the
 * thread*: no `Swipeable` quote gesture and no edit mode. Both would be wrong nested inside a list
 * row, and `editDisabled`/`accessGranted: false` is the read-only mode `MessageItemHeader` already
 * supports for shared-resource viewers.
 *
 * The email actions are the exception, and deliberately so: archiving an email, creating its task
 * or unsubscribing can be done straight from the list without opening every topic. Archive still
 * leaves the mailbox read/unread state alone, but it marks the matching Alldone chat comment as
 * read (AT-2298).
 */
export default function ChatItemUnreadMessage({
    projectId,
    chat,
    objectType,
    message,
    serverTime,
    accessGranted = false,
    linkedEmailNew = false,
    isArchivingEmail,
    isArchivedEmail,
    onArchiveLinkedEmail,
}) {
    const creatorData = useGetUserPresentationData(message.creatorId)

    // Same staleness rule as the thread, so a preview never shows a spinner the thread has
    // already given up on.
    const isLoading = resolveEffectiveMessageLoading(message, getTimestampInMilliseconds(message.lastChangeDate))

    // Same derivation as the thread: null for every message that did not come in from Gmail, which
    // is what keeps the action row off ordinary chat messages.
    const linkedEmail = getLinkedEmailFromMessage(message, { projectId, chatId: chat?.id })

    return (
        <View style={localStyles.container}>
            <MessageItemHeader
                projectId={projectId}
                message={message}
                serverTime={serverTime}
                creatorData={creatorData}
                highlight={false}
                editDisabled={true}
                accessGranted={false}
                linkedEmailNew={accessGranted && !!linkedEmail && linkedEmailNew}
            />
            <MessageItemBody
                messageId={message.id}
                projectId={projectId}
                commentText={message.commentText}
                chat={chat}
                creatorData={creatorData}
                objectType={objectType}
                isLoading={isLoading}
                assistantRun={message.assistantRun}
                linkedEmail={linkedEmail}
                linkedEmailGmailData={message.gmailData}
                linkedEmailArchiving={!!isArchivingEmail?.(linkedEmail?.key)}
                linkedEmailArchived={!!isArchivedEmail?.(linkedEmail?.key)}
                onArchiveLinkedEmail={onArchiveLinkedEmail}
                canArchiveLinkedEmail={accessGranted}
                containerStyle={localStyles.body}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 4,
    },
    body: {
        // The thread indents content by 36 to clear the 24px avatar plus its 12px gutter. The
        // preview keeps that alignment but sits in a narrower column, so it is set explicitly
        // here rather than inherited, and the row below it gets a little breathing room.
        marginLeft: 36,
        marginTop: 2,
    },
})
