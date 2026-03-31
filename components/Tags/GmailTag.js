import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import { getGmailTaskData, getGmailTaskWebUrl } from '../../utils/Gmail/gmailTaskUtils'

const GmailTag = ({ gmailData, propStyles }) => {
    const resolvedGmailData = getGmailTaskData(gmailData)
    if (!resolvedGmailData) return null

    const openLink = event => {
        event?.stopPropagation?.()
        event?.preventDefault?.()
        const webUrl = getGmailTaskWebUrl(resolvedGmailData)
        if (webUrl) return window.open(webUrl, '_blank')
    }

    const unreadCount =
        typeof resolvedGmailData.unreadMails === 'number' || typeof resolvedGmailData.unreadMails === 'string'
            ? resolvedGmailData.unreadMails
            : ''

    return (
        <TouchableOpacity
            style={[localStyles.tag, propStyles]}
            onPress={openLink}
            accessibilityLabel={'social-text-block'}
        >
            <View style={localStyles.icon}>
                <Icon name={'envelope-open'} size={16} color={colors.Text03} />
            </View>
            {unreadCount !== '' && (
                <Text style={[styles.subtitle2, localStyles.text, windowTagStyle()]}>{unreadCount}</Text>
            )}
        </TouchableOpacity>
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
})

export default GmailTag
