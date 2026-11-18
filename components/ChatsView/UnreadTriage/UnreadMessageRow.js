import React, { useState } from 'react'
import { Image, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import moment from 'moment'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import SocialText from '../../UIControls/SocialText/SocialText'
import SVGGenericUser from '../../../assets/svg/SVGGenericUser'
import { translate } from '../../../i18n/TranslationService'
import useGetUserPresentationData from '../../ContactsView/Utils/useGetUserPresentationData'
import { withMcpActorLabel } from '../../../utils/mcpActorLabel'
import { getDateFormat, getTimeFormat } from '../../UIComponents/FloatModals/DateFormatPickerModal'
import { shrinkTagText } from '../../../functions/Utils/parseTextUtils'
import { onOpenChat } from '../Utils/ChatHelper'
import { getGmailTaskWebUrl } from '../../../utils/Gmail/gmailTaskUtils'
import { useUnreadEmailArchiveContext } from '../unreadEmailArchiveContext'
import { UNREAD_TAG_ADS, UNREAD_TAG_LABEL_KEYS, UNREAD_TAG_PEOPLE } from './unreadMessageTags'

const AVATAR_SIZE = 32
// The summary may run to two or three lines (decided 2026-11-18): enough to decide without opening.
// Fewer characters on a phone, where a line holds about half as many. The height cap is the
// backstop for a long word run, since SocialText wraps word by word and cannot clamp lines itself.
export const UNREAD_SUMMARY_CHARACTER_LIMIT = 320
export const UNREAD_SUMMARY_CHARACTER_LIMIT_MOBILE = 160
const SUMMARY_MAX_LINES = 3

// The same link the thread's "Email" chip opens (GmailTag): the message in Gmail, account-aware.
export const getRowEmailUrl = message =>
    getGmailTaskWebUrl(message?.gmailData, {
        platform: Platform.OS,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        maxTouchPoints: typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0,
    })

// Lazy: the email line helpers and the backend module pull in the redux store and the Firebase
// client (see linkedEmailActions); a row test should not need either.
const openInNewTab = url => require('../../TaskListView/EmailLine/emailLineHelper').openUrlInNewTab(url)

const markCommentRead = ref =>
    require('../../../utils/backends/Chats/markChatCommentsAsRead').markChatCommentsAsRead([ref])

// Sits under the avatar, so it has to stay short: the time today, the day and month this year,
// and a two-digit year before that - in the user's own date order (DD.MM or MM.DD).
export const formatRowTime = time => {
    if (!time) return ''
    const date = moment(time)
    const now = moment()
    if (date.isSame(now, 'day')) return date.format(getTimeFormat())
    const dateFormat = getDateFormat()
    if (date.isSame(now, 'year')) return date.format(dateFormat.replace(/[./-]?YYYY[./-]?/, ''))
    return date.format(dateFormat.replace('YYYY', 'YY'))
}

/**
 * One unread message in the unread list: who sent it, its tag, a one-line summary and three
 * actions - archive (emails only), mark as read, open. Pressing the row opens it too.
 *
 * Archive goes through the chat list's shared archive (the same call and optimistic state as the
 * preview buttons), so it takes the mail out of the inbox and clears the comment's unread state in
 * one press (AT-2298, AT-2424). "Mark as read" deletes just this comment's notification doc; the
 * delete lands in the local cache at once, so the row leaves the list immediately.
 */
export default function UnreadMessageRow({ projectId, row, accessGranted, mobile }) {
    const { message, chat, tag, isEmail, linkedEmail } = row
    const creatorData = useGetUserPresentationData(isEmail ? null : message.creatorId, {
        fromAssistant: message.fromAssistant,
    })
    const archiveContext = useUnreadEmailArchiveContext()
    const archive = archiveContext?.archive
    const [markReadFailed, setMarkReadFailed] = useState(false)

    // An MCP client's comment reads "Karsten Wysk (via Claude)", as in the thread (mcpActorLabel).
    const senderName = isEmail
        ? row.senderName || translate('Email')
        : withMcpActorLabel(creatorData?.displayName, message) || row.senderName
    const canArchive = isEmail && accessGranted && !!linkedEmail && !!archive
    const archiving = canArchive && archive.isArchivingEmail(linkedEmail.key)
    const archiveFailed = canArchive && archive.isFailedEmail(linkedEmail.key)
    // Email rows of a "Daily emails" topic need no context line: every row there is an email. A
    // task comment or a conversation topic says where it was written.
    const showChatTitle = !!chat?.title && !(isEmail && /^daily emails/i.test(chat.title))

    // Pressing an email row opens the email itself in a new tab; the chat icon at the right end opens
    // the thread it was posted in (decided 2026-11-18). Any other row opens its chat. Opening the
    // email changes nothing here: once it is read or archived in Gmail, the read sync (AT-2376)
    // clears the row.
    const openChat = () => onOpenChat(projectId, chat)
    const emailUrl = isEmail ? getRowEmailUrl(message) : ''
    const openRow = emailUrl ? () => openInNewTab(emailUrl) : openChat

    const markRead = () => {
        setMarkReadFailed(false)
        return markCommentRead({ projectId, chatId: chat.id, commentId: message.id }).catch(error => {
            console.error('[unread list] Could not mark the message as read', error)
            setMarkReadFailed(true)
        })
    }

    const archiveEmail = () => {
        if (!canArchive || archiving) return
        return archive.archiveLinkedEmails([linkedEmail])
    }

    return (
        <TouchableOpacity
            style={localStyles.row}
            onPress={openRow}
            activeOpacity={0.7}
            accessibilityLabel={`${emailUrl ? `${translate('Open in Gmail')} - ` : ''}${senderName}: ${row.summary}`}
            testID={`unread-row-${message.id}`}
        >
            {/* Avatar at the top, the time under it (decided 2026-11-18). */}
            <View style={localStyles.leftColumn}>
                <View style={localStyles.avatar}>
                    {isEmail ? (
                        <View style={localStyles.emailAvatar}>
                            <Icon name="mail" size={16} color={colors.Text03} />
                        </View>
                    ) : creatorData?.photoURL ? (
                        <Image source={{ uri: creatorData.photoURL }} style={localStyles.avatarImage} />
                    ) : (
                        <SVGGenericUser width={AVATAR_SIZE} height={AVATAR_SIZE} svgid={`unread_${message.id}`} />
                    )}
                </View>
                <Text style={localStyles.time} numberOfLines={1}>
                    {formatRowTime(row.time)}
                </Text>
            </View>

            <View style={localStyles.content}>
                <View style={localStyles.headerLine}>
                    <Text style={localStyles.sender} numberOfLines={1}>
                        {senderName}
                    </Text>
                    <View
                        style={[
                            localStyles.tag,
                            tag === UNREAD_TAG_PEOPLE && localStyles.tagPeople,
                            tag === UNREAD_TAG_ADS && localStyles.tagAds,
                        ]}
                    >
                        <Text
                            style={[
                                localStyles.tagText,
                                tag === UNREAD_TAG_PEOPLE && localStyles.tagTextPeople,
                                tag === UNREAD_TAG_ADS && localStyles.tagTextAds,
                            ]}
                            numberOfLines={1}
                        >
                            {translate(UNREAD_TAG_LABEL_KEYS[tag])}
                        </Text>
                    </View>
                    {showChatTitle && !mobile && (
                        <Text style={localStyles.meta} numberOfLines={1}>
                            {chat.title}
                        </Text>
                    )}
                </View>
                <SocialText
                    style={localStyles.summary}
                    textStyle={localStyles.summaryText}
                    normalStyle={{ whiteSpace: 'normal' }}
                    wrapText
                    numberOfLines={SUMMARY_MAX_LINES}
                    projectId={projectId}
                >
                    {shrinkTagText(
                        row.summary || '',
                        mobile ? UNREAD_SUMMARY_CHARACTER_LIMIT_MOBILE : UNREAD_SUMMARY_CHARACTER_LIMIT
                    )}
                </SocialText>
            </View>

            <View style={localStyles.actions}>
                {canArchive && (
                    <RowAction
                        icon={archiveFailed ? 'x' : 'archive'}
                        label={translate(archiveFailed ? "Email couldn't be archived" : 'Archive email')}
                        onPress={archiveEmail}
                        error={archiveFailed}
                        busy={archiving}
                    />
                )}
                <RowAction
                    icon={markReadFailed ? 'x' : 'double-check'}
                    label={translate(markReadFailed ? 'Could not mark as read. Try again' : 'mark as read')}
                    onPress={markRead}
                    error={markReadFailed}
                />
                <RowAction icon="message-circle" label={translate('Open chat')} onPress={openChat} />
            </View>
        </TouchableOpacity>
    )
}

function RowAction({ icon, label, onPress, error, busy }) {
    return (
        <TouchableOpacity
            style={[localStyles.action, busy && localStyles.actionBusy]}
            onPress={event => {
                // The row itself opens the message; an action must not do that as well.
                event?.stopPropagation?.()
                onPress()
            }}
            accessibilityLabel={label}
            accessibilityRole="button"
            disabled={busy}
        >
            <Icon name={icon} size={18} color={error ? colors.UtilityRed200 : colors.Text03} />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: 8,
        paddingLeft: 8,
        paddingRight: 4,
        // Unread is the red edge, as on the Anna activity cards (AT-3075).
        borderLeftWidth: 3,
        borderLeftColor: colors.UtilityRed200,
        borderBottomWidth: 1,
        borderBottomColor: colors.Grey300,
    },
    leftColumn: {
        width: 48,
        alignItems: 'center',
        marginRight: 8,
    },
    avatar: {
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
    },
    avatarImage: {
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
        borderRadius: AVATAR_SIZE / 2,
    },
    emailAvatar: {
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
        borderRadius: AVATAR_SIZE / 2,
        backgroundColor: colors.Grey200,
        alignItems: 'center',
        justifyContent: 'center',
    },
    content: {
        flex: 1,
        minWidth: 0,
    },
    headerLine: {
        flexDirection: 'row',
        alignItems: 'center',
        minWidth: 0,
    },
    sender: {
        ...styles.subtitle1,
        color: colors.Text01,
        // The chat title next to it gives way first; the sender only shrinks past half the row.
        flexShrink: 0,
        maxWidth: '50%',
    },
    tag: {
        marginLeft: 8,
        paddingHorizontal: 8,
        borderRadius: 10,
        backgroundColor: colors.Grey200,
        flexShrink: 0,
    },
    tagPeople: {
        backgroundColor: colors.UtilityBlue100,
    },
    tagAds: {
        backgroundColor: colors.UtilityYellow100,
    },
    tagText: {
        ...styles.caption2,
        color: colors.Text02,
    },
    tagTextPeople: {
        color: colors.Primary100,
    },
    tagTextAds: {
        color: colors.UtilityYellow300,
    },
    meta: {
        ...styles.caption2,
        color: colors.Text03,
        marginLeft: 8,
        flexShrink: 1,
    },
    summary: {
        marginTop: 2,
        maxHeight: SUMMARY_MAX_LINES * styles.body2.lineHeight,
        overflow: 'hidden',
    },
    summaryText: {
        ...styles.body2,
        color: colors.Text02,
    },
    actions: {
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 8,
        flexShrink: 0,
    },
    time: {
        ...styles.caption2,
        color: colors.Text03,
        marginTop: 4,
        textAlign: 'center',
    },
    action: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 4,
    },
    actionBusy: {
        opacity: 0.4,
    },
})
