import React from 'react'
import { Image, StyleSheet, TouchableOpacity } from 'react-native'
import { colors } from '../../../../styles/global'

export default function EditorAvatar({ avatarUrl, avatarColor, openModal }) {
    return (
        <TouchableOpacity onPress={openModal}>
            <Image style={[localStyles.avatar, { borderColor: avatarColor }]} source={{ uri: avatarUrl }} />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    avatar: {
        width: 30,
        height: 30,
        borderRadius: 100,
        borderWidth: 2,
        backgroundColor: colors.Text04,
    },
})
