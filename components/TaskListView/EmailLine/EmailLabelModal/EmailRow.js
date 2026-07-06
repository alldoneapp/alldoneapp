import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import CheckBox from '../../../CheckBox'
import { translate } from '../../../../i18n/TranslationService'
import { openUrlInNewTab } from '../emailLineHelper'
import DraftReplyPopup from './DraftReplyPopup'

const POPOVER_CONTAINER_STYLE = { zIndex: 10000 }

function parseSenderName(from = '') {
    if (!from) return ''
    const match = from.match(/^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/)
    if (match && match[1].trim()) return match[1].trim()
    return from.replace(/[<>]/g, '').trim()
}

// A single email row in the label modal: multi-select checkbox, sender/subject/
// snippet, an unread dot, and an open-in-new-tab action.
// Resolves the unsubscribe destination: prefer a whitelisted https link;
// fall back to opening the message so the user can unsubscribe in the provider UI.
function resolveUnsubscribeUrl(row) {
    const unsubscribe = row?.unsubscribe
    if (!unsubscribe) return null
    if (typeof unsubscribe.httpsUrl === 'string' && unsubscribe.httpsUrl.startsWith('https://')) {
        return unsubscribe.httpsUrl
    }
    if (unsubscribe.mailto) return row.webUrl || null
    return null
}

export default function EmailRow({ row, projectId, selected, onToggleSelect, onOpen }) {
    const [draftOpen, setDraftOpen] = useState(false)
    const smallScreen = useSelector(state => state.smallScreen)
    if (!row) return null

    const unsubscribeUrl = resolveUnsubscribeUrl(row)

    return (
        <View style={localStyles.row}>
            <TouchableOpacity
                style={localStyles.checkboxArea}
                onPress={() => onToggleSelect && onToggleSelect(row)}
                accessibilityLabel={translate(selected ? 'Deselect' : 'Select')}
            >
                <CheckBox checked={selected} />
            </TouchableOpacity>

            <TouchableOpacity
                style={localStyles.content}
                onPress={() => onToggleSelect && onToggleSelect(row)}
                activeOpacity={0.7}
            >
                <View style={localStyles.topLine}>
                    {row.isUnread && <View style={localStyles.unreadDot} />}
                    <Text
                        style={[styles.subtitle2, localStyles.sender, !row.isUnread && localStyles.readText]}
                        numberOfLines={1}
                    >
                        {parseSenderName(row.from) || translate('Unknown sender')}
                    </Text>
                    {row.needsReply && (
                        <View style={localStyles.needsReplyTag}>
                            <Text style={[styles.caption2, localStyles.needsReplyTagText]}>
                                {translate('Needs reply')}
                            </Text>
                        </View>
                    )}
                </View>
                <Text style={[styles.body2, localStyles.subject]} numberOfLines={1}>
                    {row.subject || translate('No subject')}
                </Text>
                {!!row.snippet && (
                    <Text style={[styles.caption1, localStyles.snippet]} numberOfLines={1}>
                        {row.snippet}
                    </Text>
                )}
                {!!unsubscribeUrl && (
                    <TouchableOpacity
                        style={localStyles.unsubscribe}
                        onPress={() => openUrlInNewTab(unsubscribeUrl)}
                        accessibilityLabel={translate('Unsubscribe')}
                    >
                        <Icon name="slash" size={11} color={colors.Text03} />
                        <Text style={[styles.caption2, localStyles.unsubscribeText]}>{translate('Unsubscribe')}</Text>
                    </TouchableOpacity>
                )}
            </TouchableOpacity>

            <View style={localStyles.actions}>
                <Popover
                    isOpen={draftOpen}
                    position={['left', 'bottom', 'top', 'right']}
                    align="start"
                    padding={4}
                    containerStyle={POPOVER_CONTAINER_STYLE}
                    onClickOutside={() => setDraftOpen(false)}
                    contentLocation={smallScreen ? null : undefined}
                    content={
                        <DraftReplyPopup
                            projectId={projectId}
                            messageId={row.messageId}
                            closePopover={() => setDraftOpen(false)}
                        />
                    }
                >
                    <TouchableOpacity
                        style={localStyles.actionButton}
                        onPress={() => setDraftOpen(true)}
                        accessibilityLabel={translate('Draft reply')}
                    >
                        <Icon name="corner-up-left" size={16} color={colors.Text03} />
                    </TouchableOpacity>
                </Popover>
                <TouchableOpacity
                    style={localStyles.actionButton}
                    onPress={() => onOpen && onOpen(row)}
                    accessibilityLabel={translate('Open')}
                >
                    <Icon name="external-link" size={16} color={colors.Text03} />
                </TouchableOpacity>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: colors.Secondary300,
    },
    checkboxArea: {
        paddingRight: 12,
        justifyContent: 'center',
    },
    content: {
        flex: 1,
        paddingRight: 8,
    },
    topLine: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    unreadDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: colors.Primary100,
        marginRight: 6,
    },
    sender: {
        color: '#ffffff',
        flexShrink: 1,
    },
    needsReplyTag: {
        marginLeft: 8,
        paddingHorizontal: 6,
        height: 16,
        borderRadius: 8,
        backgroundColor: colors.UtilityYellow100,
        alignItems: 'center',
        justifyContent: 'center',
    },
    needsReplyTagText: {
        color: colors.UtilityYellow300,
    },
    readText: {
        color: colors.Text03,
    },
    subject: {
        color: colors.Text03,
        marginTop: 1,
    },
    snippet: {
        color: colors.Text03,
        marginTop: 1,
    },
    unsubscribe: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
        alignSelf: 'flex-start',
    },
    unsubscribeText: {
        color: colors.Text03,
        marginLeft: 4,
        textDecorationLine: 'underline',
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    actionButton: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
})
