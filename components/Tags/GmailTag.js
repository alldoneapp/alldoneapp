import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'

const GmailTag = ({ gmailData, propStyles }) => {
    const openLink = () => {
        return window.open('https://mail.google.com/mail/u/?' + `authuser=${gmailData.email}`, '_blank')
    }

    return (
        <TouchableOpacity style={[localStyles.tag, propStyles]} onPress={openLink}>
            <View style={localStyles.icon}>
                <Icon name={'envelope-open'} size={16} color={colors.Text03} />
            </View>
            <Text style={[styles.subtitle2, localStyles.text, windowTagStyle()]}>{gmailData.unreadMails}</Text>
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
