import React from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'

import styles from '../../../styles/global'

import { themed } from '../../../../Themes/colorMode'

export default function UserData({ photoURL, displayName }) {
    return (
        <View style={{ flexDirection: 'row', flex: 1, alignItems: 'center' }}>
            <Image style={localStyles.avatar} source={{ uri: photoURL }} />
            <Text style={localStyles.name}>{displayName}</Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    avatar: {
        width: 32,
        height: 32,
        borderRadius: 100,
        borderColor: themed.Surface,
    },
    name: {
        ...styles.subtitle1,
        color: '#FFFFFF',
        marginHorizontal: 8,
    },
})
