import React, { useEffect } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native'
import { useDispatch } from 'react-redux'

import styles, { em2px } from '../../styles/global'
import Icon from '../../Icon'
import { deleteCacheAndRefresh } from '../../../utils/Observers'
import { showNewVersionMandtoryNotifcation } from '../../../redux/actions'

export default function NotificationModalMandatory() {
    const dispatch = useDispatch()

    useEffect(() => {
        dispatch(showNewVersionMandtoryNotifcation())
    }, [])

    return (
        <View style={localstyles.container}>
            <Text style={[styles.title7, localstyles.title]}>Alldone.app needs to reload</Text>
            <Text style={[styles.body2, { color: '#8A94A6' }]}>
                Alldone app needs to reload in order to update features. Do not worry, we will take care of everything
                for you.
            </Text>
            <TouchableOpacity testID="refreshMandatory" style={localstyles.refresh} onPress={deleteCacheAndRefresh}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Icon name="refresh-cw" color="#FFFFFF" size={24} />
                    <Text style={localstyles.buttonText}>Refresh</Text>
                </View>
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
        color: '#FFFFFF',
        fontWeight: '500',
    },
    refresh: {
        width: 123,
        height: 40,
        borderRadius: 4,
        backgroundColor: '#0C66FF',
        justifyContent: 'center',
        paddingLeft: 16,
        alignSelf: 'center',
        marginTop: 20,
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
