import React from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../../../styles/global'
import { translate } from '../../../../../i18n/TranslationService'

export default function ConnectedUserData({ isConnected }) {
    const email = useSelector(state => state.loggedUser.email)
    const displayName = useSelector(state => state.loggedUser.displayName)
    const photoURL = useSelector(state => state.loggedUser.photoURL)

    return (
        <View style={localStyles.container}>
            <Image source={{ uri: photoURL }} style={localStyles.avatar} />
            <View style={{ flexDirection: 'column' }}>
                <Text style={localStyles.username}>{displayName}</Text>
                <Text style={localStyles.info}>
                    {translate(`${isConnected ? 'Connected' : 'Connect'} to Email`, {
                        email,
                    })}
                </Text>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        marginBottom: 20,
    },
    username: {
        ...styles.subtitle1,
        color: '#ffffff',
    },
    info: {
        ...styles.body2,
        color: colors.Text03,
    },
    avatar: {
        width: 44,
        height: 44,
        borderRadius: 100,
        marginRight: 8,
    },
})
