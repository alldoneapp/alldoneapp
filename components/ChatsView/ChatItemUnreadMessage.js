import React from 'react'
import { StyleSheet, View } from 'react-native'

import MessageItemHeader from './ChatDV/EditorView/MessageItemHeader'
import MessageItemBody from './ChatDV/EditorView/MessageItemBody'
import useGetUserPresentationData from '../ContactsView/Utils/useGetUserPresentationData'
import { getTimestampInMilliseconds } from './Utils/ChatHelper'
import { resolveEffectiveMessageLoading } from './ChatDV/EditorView/messageLoadingState'

/**
 * One unread message as previewed under a topic in the chat list (AT-2256).
 *
 * Renders through the very same components the thread uses - `MessageItemHeader` for the author
 * line and `MessageItemBody` for the content - so markdown, quotes, code blocks, mentions,
 * hashtags, links and attachments look identical to the real thread rather than to a second,
 * drifting renderer.
 *
 * What it deliberately drops from `MessageItem` is everything that is an *interaction* with the
 * thread: no `Swipeable` quote gesture and no edit mode. Both would be wrong nested inside a list
 * row, and `editDisabled`/`accessGranted: false` is the read-only mode `MessageItemHeader` already
 * supports for shared-resource viewers.
 */
export default function ChatItemUnreadMessage({ projectId, chat, objectType, message, serverTime }) {
    const creatorData = useGetUserPresentationData(message.creatorId)

    // Same staleness rule as the thread, so a preview never shows a spinner the thread has
    // already given up on.
    const isLoading = resolveEffectiveMessageLoading(message, getTimestampInMilliseconds(message.lastChangeDate))

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
                canArchiveLinkedEmail={false}
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
