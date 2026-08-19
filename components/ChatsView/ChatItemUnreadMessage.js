import React from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'

import MessageItemHeader from './ChatDV/EditorView/MessageItemHeader'
import MessageItemBody from './ChatDV/EditorView/MessageItemBody'
import useGetUserPresentationData from '../ContactsView/Utils/useGetUserPresentationData'
import { getTimestampInMilliseconds } from './Utils/ChatHelper'
import { resolveEffectiveMessageLoading } from './ChatDV/EditorView/messageLoadingState'
import { getLinkedEmailFromMessage } from './ChatDV/linkedEmailActions'
import { translate } from '../../i18n/TranslationService'

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
 * or unsubscribing can be done straight from the list without opening every topic. Archive and
 * successful task creation leave the mailbox read/unread state alone, but mark the matching
 * Alldone chat comment as read (AT-2298, AT-2310). Those nested controls keep handling their own
 * presses; pressing the preview itself opens the thread (AT-2303).
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
    onPress,
    compact = false,
}) {
    const creatorData = useGetUserPresentationData(message.creatorId)

    // Same staleness rule as the thread, so a preview never shows a spinner the thread has
    // already given up on.
    const isLoading = resolveEffectiveMessageLoading(message, getTimestampInMilliseconds(message.lastChangeDate))

    // Same derivation as the thread: null for every message that did not come in from Gmail, which
    // is what keeps the action row off ordinary chat messages.
    const linkedEmail = getLinkedEmailFromMessage(message, { projectId, chatId: chat?.id })

    return (
        <TouchableOpacity
            style={localStyles.container}
            onPress={onPress}
            activeOpacity={0.7}
            accessibilityLabel={translate('Open chat')}
        >
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
                containerStyle={compact ? localStyles.bodyCompact : localStyles.body}
            />
        </TouchableOpacity>
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
    bodyCompact: {
        // Phone widths (AT-2361): the body stops hanging under the sender avatar and starts at the
        // message's own left edge instead. Hierarchy survives because the avatar + name + time line
        // is still directly above it and the topic's rail still runs down the side - the 36px only
        // ever bought alignment with an avatar, and on a phone it costs a word or two per line in
        // the subject and pushes the email action buttons onto an extra row.
        marginLeft: 0,
        marginTop: 2,
    },
})
