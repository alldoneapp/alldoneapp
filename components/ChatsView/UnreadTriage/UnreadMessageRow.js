import React, { useState } from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import moment from 'moment'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import SocialText from '../../UIControls/SocialText/SocialText'
import SVGGenericUser from '../../../assets/svg/SVGGenericUser'
import { translate } from '../../../i18n/TranslationService'
import useGetUserPresentationData from '../../ContactsView/Utils/useGetUserPresentationData'
import { getDateFormat, getTimeFormat } from '../../UIComponents/FloatModals/DateFormatPickerModal'
import { CHAT_LAST_COMMENT_PREVIEW_CHARACTER_LIMIT, shrinkTagText } from '../../../functions/Utils/parseTextUtils'
import { onOpenChat } from '../Utils/ChatHelper'
import { useUnreadEmailArchiveContext } from '../unreadEmailArchiveContext'
import { UNREAD_TAG_ADS, UNREAD_TAG_LABEL_KEYS, UNREAD_TAG_PEOPLE } from './unreadMessageTags'

const AVATAR_SIZE = 32

// Lazy: the backend module pulls the redux store and the Firebase client (see linkedEmailActions).
const markCommentRead = ref =>
    require('../../../utils/backends/Chats/markChatCommentsAsRead').markChatCommentsAsRead([ref])

export const formatRowTime = time => {
    if (!time) return ''
    const date = moment(time)
    return date.isSame(moment(), 'day') ? date.format(getTimeFormat()) : date.format(getDateFormat())
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

    const senderName = isEmail ? row.senderName || translate('Email') : creatorData?.displayName || row.senderName
    const canArchive = isEmail && accessGranted && !!linkedEmail && !!archive
    const archiving = canArchive && archive.isArchivingEmail(linkedEmail.key)
    const archiveFailed = canArchive && archive.isFailedEmail(linkedEmail.key)
    // Email rows of a "Daily emails" topic need no context line: every row there is an email. A
    // task comment or a conversation topic says where it was written.
    const showChatTitle = !!chat?.title && !(isEmail && /^daily emails/i.test(chat.title))

    const open = () => onOpenChat(projectId, chat)

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
            onPress={open}
            activeOpacity={0.7}
            accessibilityLabel={`${senderName}: ${row.summary}`}
            testID={`unread-row-${message.id}`}
        >
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
                    numberOfLines={1}
                    projectId={projectId}
                >
                    {shrinkTagText(row.summary || '', CHAT_LAST_COMMENT_PREVIEW_CHARACTER_LIMIT)}
                </SocialText>
            </View>

            <View style={localStyles.actions}>
                <Text style={localStyles.time}>{formatRowTime(row.time)}</Text>
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
                <RowAction icon="arrow-up-right" label={translate('Open message')} onPress={open} />
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
        alignItems: 'center',
        paddingVertical: 8,
        paddingLeft: 8,
        paddingRight: 4,
        // Unread is the red edge, as on the Anna activity cards (AT-3075).
        borderLeftWidth: 3,
        borderLeftColor: colors.UtilityRed200,
        borderBottomWidth: 1,
        borderBottomColor: colors.Grey300,
    },
    avatar: {
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
        marginRight: 12,
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
    },
    summaryText: {
        ...styles.body2,
        color: colors.Text02,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 8,
        flexShrink: 0,
    },
    time: {
        ...styles.caption2,
        color: colors.Text03,
        marginRight: 4,
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
