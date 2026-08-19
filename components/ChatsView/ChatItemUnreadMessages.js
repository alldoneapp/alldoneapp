import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import useGetUnreadChatMessages from '../../hooks/Chats/useGetUnreadChatMessages'
import ChatItemUnreadMessage from './ChatItemUnreadMessage'
import { getTimestampInMilliseconds, onOpenChat } from './Utils/ChatHelper'
import SharedHelper from '../../utils/SharedHelper'
import useLinkedEmailArchive from './ChatDV/useLinkedEmailArchive'
import { getLinkedEmailsFromMessages, getNewEmailCommentIds } from './ChatDV/linkedEmailActions'
import { useRegisterUnreadLinkedEmails, useUnreadEmailArchiveContext } from './unreadEmailArchiveContext'

// How many unread messages a single row previews in full. A topic that has been running unattended
// can hold dozens of long assistant answers, and "All Projects" stacks every project's rows on one
// screen, so the newest few are shown in full and the rest are summarised by a count that points
// into the topic. The messages shown are always the newest ones - the tail of the thread the user
// is about to read.
export const CHAT_ITEM_UNREAD_PREVIEW_LIMIT = 5

// Relative timestamps ("3 minutes ago") only need to move at a human pace in a list; the thread
// itself ticks every second because a message can be seconds old while you watch it arrive.
const SERVER_TIME_REFRESH_MS = 30000

/**
 * `parseLastEdited` returns *nothing* when the clock it is given is not strictly ahead of the
 * message - the thread avoids that by asking Firebase for the server time, which a list row should
 * not do once per chat. The local clock is used instead and nudged past the newest message it is
 * about to label, so a client running a few seconds behind the server reads "1 second ago" rather
 * than rendering an empty timestamp.
 */
export const resolvePreviewServerTime = (messages, now) =>
    (messages || []).reduce((serverTime, message) => {
        const messageTime = getTimestampInMilliseconds(message?.lastChangeDate)
        return Number.isFinite(messageTime) ? Math.max(serverTime, messageTime + 1000) : serverTime
    }, now)

export const splitUnreadMessagesForPreview = (messages, limit = CHAT_ITEM_UNREAD_PREVIEW_LIMIT) => {
    const all = messages || []
    if (!Number.isFinite(limit) || all.length <= limit) return { hiddenCount: 0, visibleMessages: all }

    return { hiddenCount: all.length - limit, visibleMessages: all.slice(all.length - limit) }
}

/**
 * Previews a topic's unread messages directly under its name in the chat list (AT-2256), in full
 * and in thread order, so the user does not have to open every topic to read what is new.
 *
 * Mounted only for rows that actually have unread comments, which is what keeps the per-chat
 * comment subscription off every other row in the list.
 *
 * This component is strictly read-only: it never calls `markChatMessagesAsRead`, and it holds no
 * "seen" state of its own. Unread state stays exactly what it was - the notification docs are
 * cleared only by opening the topic or by "Mark as read", as before.
 */
export default function ChatItemUnreadMessages({ project, chat, unreadCommentIds }) {
    const { messages } = useGetUnreadChatMessages(project.id, chat.id, chat.type, unreadCommentIds)
    const loggedUser = useSelector(state => state.loggedUser)
    const chatNotifications = useSelector(state => state.projectChatNotifications?.[project.id]?.[chat.id])
    const [now, setNow] = useState(() => Date.now())

    // Same gate the thread applies to the email action row: only a project member can archive an
    // email, create its task or unsubscribe. Anonymous and non-member viewers see the message
    // content and nothing to press, exactly as they do inside the topic.
    const accessGranted = SharedHelper.accessGranted(loggedUser, project.id)

    // Which of the previewed emails are new. The thread has to *capture* these ids because opening
    // it clears the notification docs; a preview never clears anything (that is the whole point of
    // AT-2256), so the live set is read straight from the same helper the thread's hook uses.
    const newEmailCommentIds = new Set(getNewEmailCommentIds(chatNotifications))

    // One archive state for the whole chat list when the list provides one (AT-2256 follow-up), so
    // the bulk "Archive emails" buttons on the project and All Projects lines and every per-message
    // button agree on what is in flight and what is already archived. A preview mounted outside
    // that provider keeps its own state and behaves exactly as before.
    const sharedArchive = useUnreadEmailArchiveContext()?.archive
    const localArchive = useLinkedEmailArchive()
    const { archiveLinkedEmails, isArchivingEmail, isArchivedEmail } = sharedArchive || localArchive

    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), SERVER_TIME_REFRESH_MS)
        return () => clearInterval(interval)
    }, [])

    const serverTime = resolvePreviewServerTime(messages, now)
    const { hiddenCount, visibleMessages } = splitUnreadMessagesForPreview(messages)

    // What the bulk buttons act on: the emails behind the messages this row actually *previews*,
    // not every unread message of the topic - the capped-away ones are not on screen, and a header
    // button that archived emails the user cannot see would be a different, sharper action.
    // Published only for a project member, which is what gates the bulk buttons for everyone else.
    const previewedLinkedEmails = accessGranted
        ? getLinkedEmailsFromMessages(visibleMessages, { projectId: project.id, chatId: chat.id })
        : []
    useRegisterUnreadLinkedEmails(`${project.id}:${chat.id}`, project.id, previewedLinkedEmails)

    if (visibleMessages.length === 0) return null

    return (
        <View style={localStyles.container}>
            {visibleMessages.map(message => (
                <ChatItemUnreadMessage
                    key={message.id}
                    projectId={project.id}
                    chat={chat}
                    objectType={chat.type}
                    message={message}
                    serverTime={serverTime}
                    accessGranted={accessGranted}
                    linkedEmailNew={newEmailCommentIds.has(message.id)}
                    isArchivingEmail={isArchivingEmail}
                    isArchivedEmail={isArchivedEmail}
                    onArchiveLinkedEmail={archiveLinkedEmails}
                    onPress={() => onOpenChat(project.id, chat)}
                />
            ))}
            {hiddenCount > 0 && (
                // Sits *below* the previewed messages: they are the newest ones, so what this line
                // points at is what comes before them, and reading order stays "older above,
                // newer below" exactly as in the thread. The capped-away messages are still unread,
                // so this is the one affordance that must lead into the topic - reading them
                // anywhere else is not possible.
                <TouchableOpacity onPress={() => onOpenChat(project.id, chat)} accessible={false}>
                    <Text style={localStyles.hiddenCount}>
                        {translate(
                            hiddenCount === 1 ? 'One earlier unread message' : 'Amount earlier unread messages',
                            { amount: hiddenCount }
                        )}
                    </Text>
                </TouchableOpacity>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 4,
        // Aligns the preview with the topic title, which sits to the right of the row's avatar
        // column, and separates it from the title with a quiet rule rather than a box.
        borderLeftWidth: 2,
        borderLeftColor: colors.Gray300,
        paddingLeft: 12,
        marginLeft: 2,
    },
    hiddenCount: {
        ...styles.caption2,
        // Reads as the link it is: the only way to reach the unread messages the cap hid.
        color: colors.Primary100,
        // Below the previewed messages now, so it needs the gap above it rather than below.
        marginTop: 6,
    },
})
