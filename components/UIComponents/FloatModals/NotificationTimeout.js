import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native'

import styles, { em2px, colors } from '../../styles/global'
import Icon from '../../Icon'
import { deleteCacheAndRefresh } from '../../../utils/Observers'

export default function NotificationTimeout() {
    return (
        <View style={localstyles.container}>
            <Text style={localstyles.title}>Alldone.app timeout</Text>
            <Text style={localstyles.description}>
                Looks like you have had Alldone opened in the background for a while, so please reload to sync the app.
            </Text>
            <TouchableOpacity style={localstyles.button} onPress={deleteCacheAndRefresh}>
                <Icon name="refresh-cw" color="#FFFFFF" size={24} />
                <Text style={localstyles.buttonText}>Reload</Text>
            </TouchableOpacity>
        </View>
    )
}

const localstyles = StyleSheet.create({
    container: {
        width: 317,
        height: 184,
        backgroundColor: '#091540',
        padding: 16,
        borderRadius: 4,
        ...Platform.select({
            web: {
                boxShadow: `${0}px ${16}px ${32}px rgba(0,0,0,0.04), ${0}px ${16}px ${24}px rgba(0, 0, 0, 0.04)`,
            },
        }),
    },
    title: {
        ...styles.title7,
        color: '#FFFFFF',
        fontWeight: '500',
    },
    description: {
        ...styles.body2,
        color: colors.Text03,
    },
    button: {
        borderRadius: 4,
        backgroundColor: colors.Primary300,
        justifyContent: 'center',
        paddingLeft: 12,
        paddingRight: 16,
        alignSelf: 'center',
        marginTop: 20,
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
    },
    buttonText: {
        fontFamily: 'Roboto-regular',
        fontWeight: '500',
        color: '#FFFFFF',
        fontSize: 14,
        lineHeight: 14,
        letterSpacing: em2px(0.05),
        marginLeft: 12,
    },
})
