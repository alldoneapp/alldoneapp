import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors, em2px } from '../../styles/global'
import Icon from '../../Icon'
import store from '../../../redux/store'
import { setShowOptionalVersionNotification } from '../../../redux/actions'
import { deleteCacheAndRefresh } from '../../../utils/Observers'
import { translate } from '../../../i18n/TranslationService'

export default function NotificationModalOptional() {
    const alldoneNewVersion = useSelector(state => state.alldoneNewVersion)

    const close = () => {
        store.dispatch(setShowOptionalVersionNotification(false))
    }

    return (
        <View style={localstyles.container}>
            <Text style={[styles.title7, localstyles.title]}>
                {translate('Version number available', {
                    number: `${alldoneNewVersion.major}.${alldoneNewVersion.minor}`,
                })}
            </Text>
            <Text style={[styles.body2, { color: colors.Text02 }]}>{translate('Please reload to get updated')}</Text>
            <TouchableOpacity style={localstyles.refreshButton} onPress={deleteCacheAndRefresh}>
                <Icon name="refresh-ccw" size={24} color="#0D55CF" />
                <Text style={localstyles.reloadText}>{translate('Reload')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={localstyles.closeButton} onPress={close}>
                <Icon name="x" size={24} color={colors.Text03} />
            </TouchableOpacity>
        </View>
    )
}

const localstyles = StyleSheet.create({
    container: {
        zIndex: 100000,
        position: 'absolute',
        right: 56,
        bottom: 56,
        width: 256,
        height: 136,
        backgroundColor: '#C7F5E5',
        borderRadius: 4,
        ...Platform.select({
            web: {
                boxShadow: `${0}px ${16}px ${24}px rgba(0,0,0,0.04), ${0}px ${8}px ${16}px rgba(0, 0, 0, 0.04)`,
            },
        }),
        paddingLeft: 16,
        paddingTop: 16,
    },
    title: {
        color: '#07A873',
        fontWeight: '500',
    },
    closeButton: {
        position: 'absolute',
        top: 8,
        right: 8,
    },
    refreshButton: {
        flexDirection: 'row',
        width: 123,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 50,
        marginTop: 16,
    },
    reloadText: {
        fontFamily: 'Roboto-Regular',
        fontWeight: '500',
        fontSize: 14,
        lineHeight: 14,
        letterSpacing: em2px(0.05),
        color: '#0D55CF',
        marginLeft: 12,
    },
})
