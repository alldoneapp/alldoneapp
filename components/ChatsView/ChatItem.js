import React, { useMemo } from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import moment from 'moment'

import styles, { colors } from '../styles/global'
import SocialText from '../UIControls/SocialText/SocialText'
import ChatHeaderItem from './ChatHeaderItem'
import SVGGenericUser from '../../assets/svg/SVGGenericUser'
import TasksHelper from '../TaskListView/Utils/TasksHelper'
import Icon from '../Icon'
import ChatIndicator from './ChatIndicator'
import { exitsOpenModals } from '../ModalsManager/modalsManager'
import { dismissAllPopups } from '../../utils/HelperFunctions'
import { getChatIcon, onOpenChat } from './Utils/ChatHelper'
import ObjectNoteTag from '../Tags/ObjectNoteTag'
import { getTheme } from '../../Themes/Themes'
import { Themes } from '../RootView/Themes'
import { getDateFormat, getTimeFormat } from '../UIComponents/FloatModals/DateFormatPickerModal'
import ChatItemLastComment from './ChatItemLastComment'
import { getUserPresentationDataInProject } from '../ContactsView/Utils/ContactsHelper'
import { getChatItemBackgroundColor } from './chatItemBackground'
import { getUnreadCommentIds } from './Utils/unreadChatFilter'
import ChatItemUnreadMessages from './ChatItemUnreadMessages'

export default function ChatItem({ chat, project, openEditModal, inCommentPopup, onPress }) {
    const loggedUser = useSelector(state => state.loggedUser)
    // Select the *boolean*, not the counter. `state.isLoadingData` is a reference count that the
    // chats screen moves once per project listener: "All Projects" mounts one ChatsByProject per
    // project, each starting two counted listeners, so the counter takes ~2xN steps up and ~2xN
    // steps back down (156 for a 78-project account). Those dispatches come from Firestore snapshot
    // callbacks, so React cannot batch them, and selecting the raw number re-rendered every mounted
    // ChatItem on each step even though the only thing rendered from it is `!isLoadingData`
    // (see the ChatIndicator background below). The reducer clamps the counter at 0, so
    // `!isLoadingData` and `!(isLoadingData > 0)` are equivalent. See AT-2200.
    const isLoadingData = useSelector(state => state.isLoadingData > 0)
    const showFloatPopup = useSelector(state => state.showFloatPopup)
    const chatNotifications = useSelector(state => state.projectChatNotifications[project.id][chat.id])
    const chatsActiveTab = useSelector(state => state.chatsActiveTab)

    const totalFollowed = chatNotifications ? chatNotifications.totalFollowed : 0
    const totalUnfollowed = chatNotifications ? chatNotifications.totalUnfollowed : 0
    const notificationsAmount = totalFollowed || totalUnfollowed

    // The unread messages previewed under the title (AT-2256). Never in a comment popup: that
    // popup is a compact picker of chats, and it already renders the thread it is pointing at.
    const unreadCommentIds = useMemo(
        () => (inCommentPopup ? [] : getUnreadCommentIds(chatNotifications, chatsActiveTab)),
        [chatNotifications, chatsActiveTab, inCommentPopup]
    )

    const hasUnreadPreview = unreadCommentIds.length > 0

    const isSticky = chat.stickyData.days > 0
    const theme = getTheme(Themes, loggedUser.themeName, 'RootView.StickyItem')
    const backgroundColor = getChatItemBackgroundColor(chat.hasStar, inCommentPopup)
    const usesCommentPopupBackground = inCommentPopup

    const onOpenEditModal = () => {
        if (showFloatPopup === 0 && openEditModal && !exitsOpenModals()) {
            openEditModal()
        } else {
            dismissAllPopups(true, true, true)
        }
    }

    return (
        <View
            style={[
                localStyles.container,
                isSticky && !inCommentPopup && [localStyles.containerSticky, theme.containerSticky(project.color)],
                { backgroundColor },
            ]}
        >
            <TouchableOpacity onPress={inCommentPopup ? onPress : onOpenEditModal} accessible={false}>
                <ChatHeaderItem members={chat.members} membersNumber={chat.members.length} />
            </TouchableOpacity>
            {/* The unread preview is a sibling of the title touchable because each previewed
                message owns its open-the-chat action while its nested links and email controls
                keep their existing actions. */}
            <View style={{ flex: 1 }}>
                <TouchableOpacity
                    onPress={inCommentPopup ? onPress : () => onOpenChat(project.id, chat)}
                    accessible={false}
                >
                    <View style={localStyles.content}>
                        <View style={localStyles.titleArea}>
                            <View style={localStyles.descriptionContainer}>
                                <SocialText
                                    elementId={`social_text_${project.id}_${chat.id}`}
                                    style={[
                                        styles.body1,
                                        localStyles.descriptionText,
                                        { color: usesCommentPopupBackground ? colors.UtilityBlue100 : colors.Text01 },
                                    ]}
                                    normalStyle={{ whiteSpace: 'normal' }}
                                    numberOfLines={3}
                                    wrapText
                                    projectId={project.id}
                                    bgColor={backgroundColor}
                                    leftCustomElement={IconToRender(chat, project)}
                                >
                                    {chat.title}
                                </SocialText>
                            </View>
                        </View>
                        <View style={localStyles.tagsArea}>
                            <Text
                                style={[
                                    styles.caption2,
                                    { color: usesCommentPopupBackground ? colors.UtilityBlue125 : colors.Text03 },
                                ]}
                            >
                                {parseDate(chat.lastEditionDate)}
                            </Text>
                            {!!notificationsAmount && (
                                <ChatIndicator
                                    notificationsAmount={notificationsAmount}
                                    backgroundColor={
                                        !isLoadingData && (totalFollowed > 0 ? colors.UtilityRed200 : colors.Gray500)
                                    }
                                />
                            )}
                            <View style={{ flexDirection: 'row', marginLeft: 'auto' }}>
                                {chat.noteId && (
                                    <ObjectNoteTag
                                        objectId={chat.id}
                                        objectType="chats"
                                        projectId={project.id}
                                        style={{ marginLeft: 8 }}
                                    />
                                )}
                            </View>
                        </View>
                    </View>
                    {/* The one-line teaser would repeat the newest unread message that is already
                        rendered in full just below, so it stands down while a preview is shown. */}
                    {!!chat.commentsData && !hasUnreadPreview && (
                        <ChatItemLastComment
                            projectId={project.id}
                            commentOwnerId={chat.commentsData.lastCommentOwnerId}
                            comment={chat.commentsData.lastComment}
                            inCommentPopup={usesCommentPopupBackground}
                        />
                    )}
                </TouchableOpacity>
                {hasUnreadPreview && (
                    <ChatItemUnreadMessages project={project} chat={chat} unreadCommentIds={unreadCommentIds} />
                )}
            </View>
        </View>
    )
}

const parseDate = date => {
    const today = moment()
    if (today.isSame(moment(date), 'd')) {
        return moment(date).format(getTimeFormat())
    }
    return moment(date).format(getDateFormat(false, true))
}

const IconToRender = (chat, project) => {
    return (
        <View style={{ marginRight: 12 }}>
            {chat.type === 'contacts' ? (
                getContactItem(project.id, chat)
            ) : (
                <Icon name={getChatIcon(chat)} size={24} color={colors.Text03} />
            )}
        </View>
    )
}

const getContactItem = (projectId, chat) => {
    const { photoURL } =
        getUserPresentationDataInProject(projectId, chat.id) || TasksHelper.getContactInProject(projectId, chat.id)
    return photoURL ? (
        <Image source={{ uri: photoURL }} style={localStyles.userImage} />
    ) : (
        <View style={{ borderRadius: 100, overflow: 'hidden' }}>
            <SVGGenericUser width={24} height={24} svgid={`ci_p_${chat.id}`} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        borderRadius: 4,
        flexDirection: 'row',
        paddingVertical: 18,
        paddingHorizontal: 8,
        marginHorizontal: -8,
    },
    content: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    titleArea: {
        flexDirection: 'row',
        flex: 1,
    },
    tagsArea: {
        flexDirection: 'row',
        marginLeft: 10,
        height: 24,
        alignItems: 'center',
        marginTop: 4,
    },
    descriptionText: {
        display: 'flex',
        alignItems: 'flex-start',
        maxHeight: 90,
    },
    descriptionContainer: {
        flexGrow: 1,
        flex: 1,
    },
    userImage: {
        width: 24,
        height: 24,
        borderRadius: 100,
    },
    containerSticky: {
        borderRadius: 4,
        paddingHorizontal: 8,
        marginLeft: -8,
        marginRight: -8,
    },
})
