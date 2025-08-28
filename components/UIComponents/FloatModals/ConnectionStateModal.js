import React, { useEffect } from 'react'
import { View, Text, StyleSheet, Platform } from 'react-native'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import CloseButton from '../../FollowUp/CloseButton'
import { translate } from '../../../i18n/TranslationService'

export default function ConnectionStateModal({ connectionState, closeModal }) {
    const isOnline = connectionState === 'online'

    useEffect(() => {
        if (connectionState === 'online') {
            const MILLISECONDS_THAT_THE_MODAL_IS_VISIBLE = 5000
            const timeOut = setTimeout(() => {
                closeModal()
            }, MILLISECONDS_THAT_THE_MODAL_IS_VISIBLE)
            return () => {
                clearTimeout(timeOut)
            }
        }
    }, [connectionState])

    return (
        <View style={[localstyles.container, isOnline ? localstyles.containerOnline : localstyles.containerOffline]}>
            <View style={localstyles.titleContainer}>
                <Icon
                    name={isOnline ? 'cloud' : 'cloud-off'}
                    size={24}
                    color={isOnline ? colors.UtilityGreen300 : colors.UtilityRed300}
                />
                <Text style={[localstyles.title, isOnline ? localstyles.titleOnline : localstyles.titleOffline]}>
                    {translate(`Alldone is ${isOnline ? 'online' : 'offline'}`)}
                </Text>
            </View>
            <Text style={localstyles.description}>
                {translate(
                    isOnline
                        ? 'Alldone is online again, all functionalities are available'
                        : 'Edition in notes will be disabled till Alldone goes back online again'
                )}
            </Text>
            <CloseButton style={localstyles.closeButton} close={closeModal} />
        </View>
    )
}

const localstyles = StyleSheet.create({
    container: {
        zIndex: 100000,
        position: 'absolute',
        right: 56,
        bottom: 56,
        borderRadius: 4,
        paddingVertical: 16,
        paddingLeft: 16,
        paddingRight: 8,
        width: 256,
        height: 102,
        ...Platform.select({
            web: {
                boxShadow: `${0}px ${16}px ${24}px rgba(0,0,0,0.04), ${0}px ${8}px ${16}px rgba(0, 0, 0, 0.04)`,
            },
        }),
    },
    containerOffline: {
        backgroundColor: colors.UtilityRed112,
    },
    containerOnline: {
        backgroundColor: colors.UtilityGreen112,
    },
    titleContainer: {
        flexDirection: 'row',
    },
    title: {
        marginLeft: 10,
        ...styles.title7,
    },
    titleOffline: {
        color: colors.UtilityRed300,
    },
    titleOnline: {
        color: colors.Green300,
    },
    description: {
        ...styles.body2,
        color: colors.Text02,
    },
    closeButton: {
        top: 8,
        right: 8,
    },
})
