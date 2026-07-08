import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Popover from 'react-tiny-popover'
import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import { getGmailTaskData, getGmailTaskWebUrl } from '../../utils/Gmail/gmailTaskUtils'
import { translate } from '../../i18n/TranslationService'
import { openUrlInNewTab } from '../TaskListView/EmailLine/emailLineHelper'
import DraftReplyPopup from '../TaskListView/EmailLine/EmailLabelModal/DraftReplyPopup'

const POPOVER_CONTAINER_STYLE = { zIndex: 10000 }

function stopEvent(event) {
    event?.stopPropagation?.()
    event?.preventDefault?.()
}

function getDraftConnectionKey(gmailData) {
    return (
        gmailData?.connectionId ||
        gmailData?.projectId ||
        gmailData?.selectedProjectId ||
        gmailData?.taskProjectId ||
        ''
    )
}

function getDraftMessageId(gmailData) {
    return gmailData?.messageId || (Array.isArray(gmailData?.messageIds) ? gmailData.messageIds[0] : '')
}

const GmailTag = ({ gmailData, propStyles, showLabel, label = 'Email', iconSize = 16 }) => {
    const [isOpen, setIsOpen] = useState(false)
    const [draftOpen, setDraftOpen] = useState(false)
    const resolvedGmailData = getGmailTaskData(gmailData)
    if (!resolvedGmailData) return null

    const openLink = event => {
        stopEvent(event)
        const webUrl = getGmailTaskWebUrl(resolvedGmailData)
        if (webUrl) openUrlInNewTab(webUrl)
        setIsOpen(false)
    }

    const openOptions = event => {
        stopEvent(event)
        setDraftOpen(false)
        setIsOpen(true)
    }

    const connectionKey = getDraftConnectionKey(resolvedGmailData)
    const messageId = getDraftMessageId(resolvedGmailData)
    const canDraftReply = !!connectionKey && !!messageId

    const unreadCount =
        typeof resolvedGmailData.unreadMails === 'number' || typeof resolvedGmailData.unreadMails === 'string'
            ? resolvedGmailData.unreadMails
            : ''

    const trigger = (
        <TouchableOpacity
            style={[localStyles.tag, propStyles]}
            onPress={openOptions}
            accessibilityLabel={'social-text-block'}
        >
            <View style={localStyles.icon}>
                <Icon name={'envelope-open'} size={iconSize} color={colors.Text03} />
            </View>
            {showLabel && (
                <Text style={[styles.subtitle2, localStyles.text, windowTagStyle()]}>{translate(label)}</Text>
            )}
            {unreadCount !== '' && (
                <Text style={[styles.subtitle2, localStyles.text, windowTagStyle()]}>{unreadCount}</Text>
            )}
        </TouchableOpacity>
    )

    const closePopover = () => {
        setDraftOpen(false)
        setIsOpen(false)
    }

    return (
        <Popover
            isOpen={isOpen}
            position={['bottom', 'top', 'right', 'left']}
            align="start"
            padding={4}
            containerStyle={POPOVER_CONTAINER_STYLE}
            onClickOutside={closePopover}
            content={
                draftOpen ? (
                    <DraftReplyPopup projectId={connectionKey} messageId={messageId} closePopover={closePopover} />
                ) : (
                    <View style={localStyles.menu}>
                        <TouchableOpacity style={localStyles.menuItem} onPress={openLink}>
                            <Icon name="external-link" size={16} color={colors.Primary100} />
                            <Text style={[styles.subtitle2, localStyles.menuItemText]}>{translate('Open Email')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[localStyles.menuItem, !canDraftReply && localStyles.menuItemDisabled]}
                            onPress={event => {
                                stopEvent(event)
                                if (canDraftReply) setDraftOpen(true)
                            }}
                            disabled={!canDraftReply}
                        >
                            <Icon
                                name="corner-up-left"
                                size={16}
                                color={canDraftReply ? colors.Primary100 : colors.Text03}
                            />
                            <Text
                                style={[
                                    styles.subtitle2,
                                    localStyles.menuItemText,
                                    !canDraftReply && localStyles.menuItemTextDisabled,
                                ]}
                            >
                                {translate('Draft Reply')}
                            </Text>
                        </TouchableOpacity>
                    </View>
                )
            }
        >
            {trigger}
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    tag: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.Gray300,
        borderRadius: 12,
        paddingHorizontal: 8,
        marginRight: -8,
        height: 24,
    },
    text: {
        color: colors.Text03,
        marginLeft: 6,
        marginRight: 4,
    },
    icon: {
        flexDirection: 'row',
        alignSelf: 'center',
    },
    menu: {
        width: 180,
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        paddingVertical: 6,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOpacity: 1,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 4 },
    },
    menuItem: {
        minHeight: 36,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
    },
    menuItemDisabled: {
        opacity: 0.5,
    },
    menuItemText: {
        color: '#ffffff',
        marginLeft: 8,
    },
    menuItemTextDisabled: {
        color: colors.Text03,
    },
})

export default GmailTag
