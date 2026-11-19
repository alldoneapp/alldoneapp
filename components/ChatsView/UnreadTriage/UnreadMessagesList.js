import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import SharedHelper from '../../../utils/SharedHelper'
import useGetUnreadChatMessages from '../../../hooks/Chats/useGetUnreadChatMessages'
import { getUserPresentationData } from '../../ContactsView/Utils/ContactsHelper'
import { withMcpActorLabel } from '../../../utils/mcpActorLabel'
import { getUnreadCommentIds } from '../Utils/unreadChatFilter'
import { getLinkedEmailFromMessage } from '../ChatDV/linkedEmailActions'
import { useRegisterUnreadLinkedEmails } from '../unreadEmailArchiveContext'
import { useUnreadTriage } from './UnreadTriageContext'
import UnreadMessageRow from './UnreadMessageRow'
import {
    UNREAD_SORT_NEWEST,
    UNREAD_TAG_ALL,
    countRowsByTag,
    filterRowsByTag,
    getEmailRowContent,
    getMessageTime,
    getUnreadMessageTag,
    isEmailMessage,
    sortRows,
    toOneLineSummary,
} from './unreadMessageTags'

/**
 * Subscribes to one chat's unread comments and hands them to the list. Renders nothing: the list
 * needs every chat's messages in one place to sort and filter them across chats.
 */
function UnreadChatMessagesSource({ projectId, chat, unreadCommentIds, onMessages }) {
    const { messages } = useGetUnreadChatMessages(projectId, chat.id, chat.type, unreadCommentIds)
    const signature = messages.map(message => `${message.id}:${getMessageTime(message)}`).join('|')

    useEffect(() => {
        onMessages(chat.id, messages)
    }, [chat.id, signature])

    useEffect(() => () => onMessages(chat.id, null), [chat.id])

    return null
}

export const buildUnreadRows = (projectId, chats, messagesByChat) =>
    chats.flatMap(chat =>
        (messagesByChat[chat.id] || []).map(message => {
            const isEmail = isEmailMessage(message)
            const emailContent = isEmail ? getEmailRowContent(message) : null
            return {
                key: `${chat.id}:${message.id}`,
                message,
                chat,
                isEmail,
                tag: getUnreadMessageTag(message),
                senderName: isEmail
                    ? emailContent.senderName
                    : withMcpActorLabel(getUserPresentationData(message.creatorId)?.displayName || '', message),
                summary: toOneLineSummary(isEmail ? emailContent.summary : message.commentText),
                time: getMessageTime(message),
                linkedEmail: isEmail ? getLinkedEmailFromMessage(message, { projectId, chatId: chat.id }) : null,
            }
        })
    )

/**
 * The unread list of one project (Chats > Unread): every unread message of the project's unread
 * chats as one row, filtered by the selected tag and sorted by the selected order.
 */
export default function UnreadMessagesList({ project, chats }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const projectNotifications = useSelector(state => state.projectChatNotifications?.[project.id])
    const triage = useUnreadTriage()
    const tagFilter = triage?.tagFilter || UNREAD_TAG_ALL
    const sortMode = triage?.sortMode || UNREAD_SORT_NEWEST
    const [messagesByChat, setMessagesByChat] = useState({})

    // Only a member may archive, as in the thread and the previews (SharedHelper.accessGranted).
    const accessGranted = SharedHelper.accessGranted(loggedUser, project.id)

    const reportMessages = useCallback((chatId, messages) => {
        setMessagesByChat(current => {
            if (messages === null) {
                if (!current[chatId]) return current
                const { [chatId]: removed, ...rest } = current
                return rest
            }
            return { ...current, [chatId]: messages }
        })
    }, [])

    const rows = useMemo(() => buildUnreadRows(project.id, chats, messagesByChat), [project.id, chats, messagesByChat])
    const counts = useMemo(() => countRowsByTag(rows), [rows])
    const visibleRows = useMemo(() => sortRows(filterRowsByTag(rows, tagFilter), sortMode), [rows, tagFilter, sortMode])

    const visibleCommentRefs = useMemo(
        () => visibleRows.map(row => ({ projectId: project.id, chatId: row.chat.id, commentId: row.message.id })),
        [project.id, visibleRows]
    )
    const registerProject = triage?.registerProject
    const unregisterProject = triage?.unregisterProject
    useEffect(() => {
        if (registerProject) registerProject(project.id, counts, visibleCommentRefs)
    }, [registerProject, project.id, counts, visibleCommentRefs])
    useEffect(() => () => unregisterProject && unregisterProject(project.id), [unregisterProject, project.id])

    // Feeds the chat list's email registry: the "Archive emails" buttons act on the emails this
    // view shows (the filtered rows), and the Gmail read sync (AT-2376) checks every unread email
    // of the project, shown or filtered away.
    // One entry per row; the registry merges rows of the same email (collectUnreadLinkedEmails).
    const visibleLinkedEmails = useMemo(
        () => (accessGranted ? visibleRows.filter(row => row.linkedEmail).map(row => row.linkedEmail) : []),
        [accessGranted, visibleRows]
    )
    const allLinkedEmails = useMemo(
        () => (accessGranted ? rows.filter(row => row.linkedEmail).map(row => row.linkedEmail) : []),
        [accessGranted, rows]
    )
    useRegisterUnreadLinkedEmails(`${project.id}:unread-list`, project.id, visibleLinkedEmails, allLinkedEmails)

    return (
        <View testID={`unread-list-${project.id}`}>
            {chats.map(chat => (
                <UnreadChatMessagesSource
                    key={chat.id}
                    projectId={project.id}
                    chat={chat}
                    unreadCommentIds={getUnreadCommentIds(projectNotifications?.[chat.id])}
                    onMessages={reportMessages}
                />
            ))}
            {visibleRows.map(row => (
                <UnreadMessageRow
                    key={row.key}
                    projectId={project.id}
                    row={row}
                    accessGranted={accessGranted}
                    mobile={mobile}
                />
            ))}
            {rows.length > 0 && visibleRows.length === 0 && (
                <Text style={localStyles.empty}>{translate('Nothing unread with this tag')}</Text>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    empty: {
        ...styles.body2,
        color: colors.Text03,
        paddingVertical: 12,
        paddingLeft: 11,
    },
})
