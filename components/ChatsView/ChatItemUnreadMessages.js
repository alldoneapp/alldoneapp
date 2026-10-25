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
import { CHAT_AVATAR_COLUMN_TOTAL_WIDTH, CHAT_PREVIEW_MOBILE_GUTTER, CHAT_PREVIEW_RAIL_WIDTH } from './chatRowLayout'

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
    // Phone-width layout (AT-2361). Read once here and passed down rather than subscribed to per
    // previewed message, so a resize costs one re-render per row instead of one per message.
    const mobile = useSelector(state => state.smallScreenNavigation)
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
    // Every unread email of the row, preview cap included, is published alongside it for the Gmail
    // read sync (AT-2376) only. A "Daily emails" topic holds a whole day of emails in one row, so
    // reconciling just the previewed five against the mailbox would leave the older ones unread for
    // good. The bulk archive buttons keep acting on the previewed set above.
    const unreadLinkedEmails = accessGranted
        ? getLinkedEmailsFromMessages(messages, { projectId: project.id, chatId: chat.id })
        : []
    useRegisterUnreadLinkedEmails(`${project.id}:${chat.id}`, project.id, previewedLinkedEmails, unreadLinkedEmails)

    if (visibleMessages.length === 0) return null

    return (
        <View style={[localStyles.container, mobile && localStyles.containerMobile]}>
            {visibleMessages.map(message => (
                <ChatItemUnreadMessage
                    key={message.id}
                    compact={mobile}
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
        borderLeftWidth: CHAT_PREVIEW_RAIL_WIDTH,
        borderLeftColor: colors.Gray300,
        paddingLeft: 12,
        marginLeft: 2,
    },
    containerMobile: {
        // On a phone the row's avatar column is 64px of *empty* space for the whole height of the
        // preview - the avatars themselves only occupy its first ~44px, next to the topic title -
        // while the email comments underneath pay for it on every single line: sender, subject,
        // body and the Email/Create task/Archive/Unsubscribe row all get ~26% less width than the
        // screen has (AT-2361). The preview therefore steps back out of that column and starts at
        // the row's own left edge, keeping the rail as the thread cue. The negative margin only
        // grows the box to the left, so the right edge - and every other row in the list - is
        // untouched, and the space it moves into is empty by construction.
        marginLeft: -CHAT_AVATAR_COLUMN_TOTAL_WIDTH,
        // The rail stays, so the messages still read as belonging to the topic above them; only
        // its gutter changes, because there is no avatar column left to separate from. Stepping
        // all the way out left the text 10px from the screen edge, which reads as flush rather
        // than as part of the row (AT-2368): the gutter now puts the preview's first pixel of text
        // on the list's own 16px margin, so it is balanced against the edge and against the rest
        // of the row without giving back the width AT-2361 recovered.
        paddingLeft: CHAT_PREVIEW_MOBILE_GUTTER,
    },
    hiddenCount: {
        ...styles.caption2,
        // Reads as the link it is: the only way to reach the unread messages the cap hid.
        color: colors.Primary100,
        // Below the previewed messages now, so it needs the gap above it rather than below.
        marginTop: 6,
    },
})
